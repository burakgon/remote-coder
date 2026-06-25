import { fileURLToPath } from "node:url";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { WebSocket } from "ws";
import { startServer, SessionManager, createServer, openSessionStore, HistoryService } from "../src/index.js";
import type { CreateServerResult, ServerFrame, ServerRuntimeConfig } from "../src/index.js";

const MOCK = fileURLToPath(new URL("./helpers/mock-claude-interactive.mjs", import.meta.url));

let dir: string;
let running: (CreateServerResult & { url: string }) | undefined;
let direct: CreateServerResult | undefined;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "rc-boot-"));
});
afterEach(async () => {
  if (running) await running.app.close();
  if (direct) await direct.app.close();
  running = undefined;
  direct = undefined;
  await rm(dir, { recursive: true, force: true });
});

/** Env that drives startServer against the interactive mock on a sandboxed data dir. */
function envFor(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    PORT: "0",
    BIND_ADDRESS: "127.0.0.1",
    CLAUDE_BIN: process.execPath,
    REMOTE_CODER_DATA_DIR: dir,
    ...extra,
  } as NodeJS.ProcessEnv;
}

test("first run on loopback generates + persists + reports a token", async () => {
  running = await startServer(envFor());
  expect(running.tokenGenerated).toBe(true);
  expect(typeof running.token).toBe("string");
  expect((running.token ?? "").length).toBeGreaterThan(20);

  // Persisted to the data dir so the SECOND boot reuses it (not regenerated).
  const persisted = (await readFile(join(dir, "token"), "utf8")).trim();
  expect(persisted).toBe(running.token);

  // The token actually gates: an unauthenticated request is rejected.
  const res = await running.app.inject({ method: "GET", url: "/sessions" });
  expect(res.statusCode).toBe(401);
  const ok = await running.app.inject({
    method: "GET",
    url: "/sessions",
    headers: { authorization: `Bearer ${running.token}` },
  });
  expect(ok.statusCode).toBe(200);
});

test("second boot reuses the persisted token (tokenGenerated false)", async () => {
  const first = await startServer(envFor());
  const token = first.token;
  await first.app.close();

  running = await startServer(envFor());
  expect(running.tokenGenerated).toBe(false);
  expect(running.token).toBe(token);
});

test("NO_TOKEN=1 on loopback boots tokenless (no token required)", async () => {
  running = await startServer(envFor({ NO_TOKEN: "1" }));
  expect(running.token).toBeUndefined();
  expect(running.tokenGenerated).toBe(false);
  // No token configured -> the gate allows.
  const res = await running.app.inject({ method: "GET", url: "/sessions" });
  expect(res.statusCode).toBe(200);
});

// Dormant -> resume on message. `startServer` constructs a real (mock-less) SessionManager, so the
// resume path is exercised at the createServer layer with a mock-driving manager and a shared store
// (exactly what startServer wires, minus the unmockable real-binary spawn). loadFromStore() rehydrates
// the dormant meta; a WS message triggers ensureLive -> manager.resumeSession (claude --resume).
const TOKEN = "boot-token";
function configFor(): ServerRuntimeConfig {
  return {
    port: 0,
    bindAddress: "127.0.0.1",
    accessToken: TOKEN,
    fsRoot: process.cwd(),
    maxUploadBytes: 26214400,
    dataDir: dir,
    claude: { claudeBin: process.execPath },
  };
}
function managerFor(mode: string) {
  return new SessionManager(
    { claudeBin: process.execPath },
    { spawnPrefixArgs: [MOCK], baseEnv: { ...process.env, MOCK_MODE: mode }, startTimeoutMs: 5000 },
  );
}

test("a message to a persisted-but-dead (dormant) session resumes it via claude --resume", async () => {
  const dbPath = join(dir, "sessions.db");
  // Server 1: create a session, then close (the live process dies; the store persists the meta).
  let id: string;
  {
    const store = openSessionStore({ dbPath });
    const s1 = createServer(configFor(), managerFor("simple"), {
      store,
      history: new HistoryService({ claudeHome: dir }),
    });
    const created = await s1.app.inject({
      method: "POST",
      url: "/sessions",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { cwd: process.cwd() },
    });
    expect(created.statusCode).toBe(201);
    id = created.json().session.id as string;
    // A resumable session has a transcript on disk; write one so it survives the restart (an unused,
    // transcript-less session is intentionally pruned as dead on rehydrate — session-hub.prune.test.ts).
    const tpath = new HistoryService({ claudeHome: dir }).transcriptPath(process.cwd(), id);
    await mkdir(dirname(tpath), { recursive: true });
    await writeFile(tpath, '{"type":"user","message":{"content":[{"type":"text","text":"hi"}]}}\n');
    await s1.app.close();
    store.close();
  }

  // Server 2: same db -> the session rehydrates as DORMANT. A message must spawn `claude --resume`
  // (the mock "resume" mode emits a warm-up then a normal turn) and flip the meta to running.
  const store2 = openSessionStore({ dbPath });
  direct = createServer(configFor(), managerFor("resume"), {
    store: store2,
    history: new HistoryService({ claudeHome: dir }),
  });
  const url = await direct.app.listen({ port: 0, host: "127.0.0.1" });

  const list = await direct.app.inject({
    method: "GET",
    url: "/sessions",
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  const sessions = list.json().sessions as { id: string; status: string }[];
  expect(sessions.find((s) => s.id === id)?.status).toBe("dormant");

  const wsBase = url.replace(/^http/, "ws");
  await new Promise<void>((resolve, reject) => {
    let sent = false;
    const ws = new WebSocket(`${wsBase}/sessions/${id}/ws?token=${TOKEN}`);
    ws.on("open", () => {
      sent = true;
      ws.send(JSON.stringify({ type: "user", content: "continue please" }));
    });
    ws.on("message", (raw: Buffer) => {
      const frame: ServerFrame = JSON.parse(raw.toString());
      if (frame.kind === "result") {
        ws.close();
        resolve();
      }
    });
    ws.on("error", reject);
    setTimeout(() => reject(new Error(sent ? "dormant resume: no result" : "dormant resume: ws never opened")), 12000);
  });

  // After the resume the meta flips to running.
  const after = await direct.app.inject({
    method: "GET",
    url: "/sessions",
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  const afterSessions = after.json().sessions as { id: string; status: string }[];
  expect(afterSessions.find((s) => s.id === id)?.status).toBe("running");
}, 30000);
