import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { SessionManager, createServer, openSessionStore, openIdempotencyStore, HistoryService } from "../src/index.js";
import type { CreateServerResult, ServerRuntimeConfig } from "../src/index.js";

const MOCK = fileURLToPath(new URL("./helpers/mock-claude-interactive.mjs", import.meta.url));
const TOKEN = "dur-token";

let dir: string;
let current: CreateServerResult | undefined;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "rc-dur-"));
});
afterEach(async () => {
  if (current) await current.app.close();
  current = undefined;
  await rm(dir, { recursive: true, force: true });
});

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
function managerFor() {
  return new SessionManager(
    { claudeBin: process.execPath },
    { spawnPrefixArgs: [MOCK], baseEnv: { ...process.env, MOCK_MODE: "simple" }, startTimeoutMs: 5000 },
  );
}

test("Idempotency-Key dedupes POST /sessions", async () => {
  const store = openSessionStore({ dbPath: join(dir, "s.db") });
  const idempotency = openIdempotencyStore({ dbPath: join(dir, "i.db") });
  current = createServer(configFor(), managerFor(), { store, idempotency, history: new HistoryService() });

  const headers = { authorization: `Bearer ${TOKEN}`, "idempotency-key": "k1" };
  const a = await current.app.inject({ method: "POST", url: "/sessions", headers, payload: { cwd: process.cwd() } });
  const b = await current.app.inject({ method: "POST", url: "/sessions", headers, payload: { cwd: process.cwd() } });
  expect(a.statusCode).toBe(201);
  expect(b.statusCode).toBe(200);
  expect(b.json().session.id).toBe(a.json().session.id);
});

test("concurrent same-key POST /sessions yields exactly ONE session (no double-spawn)", async () => {
  const store = openSessionStore({ dbPath: join(dir, "s.db") });
  const idempotency = openIdempotencyStore({ dbPath: join(dir, "i.db") });
  current = createServer(configFor(), managerFor(), { store, idempotency, history: new HistoryService() });

  const headers = { authorization: `Bearer ${TOKEN}`, "idempotency-key": "race" };
  // Fire both BEFORE either resolves: the in-flight lock must collapse them to one create.
  const [a, b] = await Promise.all([
    current.app.inject({ method: "POST", url: "/sessions", headers, payload: { cwd: process.cwd() } }),
    current.app.inject({ method: "POST", url: "/sessions", headers, payload: { cwd: process.cwd() } }),
  ]);
  expect(a.json().session.id).toBe(b.json().session.id);
  // Exactly one live session was spawned.
  const list = await current.app.inject({
    method: "GET",
    url: "/sessions",
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  expect(list.json().sessions).toHaveLength(1);
});

test("a session created in one server is DORMANT after a restart (rehydrated from the store)", async () => {
  const dbPath = join(dir, "s.db");
  // Server 1: create a session, then close.
  {
    const store = openSessionStore({ dbPath });
    current = createServer(configFor(), managerFor(), { store, history: new HistoryService() });
    const created = await current.app.inject({
      method: "POST",
      url: "/sessions",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { cwd: process.cwd() },
    });
    expect(created.statusCode).toBe(201);
    await current.app.close();
    store.close();
    current = undefined;
  }
  // Server 2: same db -> the session reappears as dormant (no live process).
  const store2 = openSessionStore({ dbPath });
  current = createServer(configFor(), managerFor(), { store: store2, history: new HistoryService() });
  const list = await current.app.inject({
    method: "GET",
    url: "/sessions",
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  const sessions = list.json().sessions as { id: string; status: string }[];
  expect(sessions).toHaveLength(1);
  expect(sessions[0]?.status).toBe("dormant");
});

test("GET /sessions/:id reads jsonl history for a dormant session after a restart", async () => {
  const dbPath = join(dir, "s.db");
  // The history transcript lives under <claudeHome>/.claude/projects/<encodeProjectDir(cwd)>/<id>.jsonl.
  // Use a sandboxed claudeHome inside the temp dir so the test never touches the real ~/.claude.
  const claudeHome = join(dir, "home");
  const sessionCwd = join(dir, "work");
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { encodeProjectDir } = await import("@remote-coder/protocol");
  await mkdir(sessionCwd, { recursive: true });

  // Server 1: create a session in sessionCwd, then close (no live process survives).
  let id: string;
  {
    const store = openSessionStore({ dbPath });
    current = createServer(configFor(), managerFor(), { store, history: new HistoryService({ claudeHome }) });
    const created = await current.app.inject({
      method: "POST",
      url: "/sessions",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { cwd: sessionCwd },
    });
    id = created.json().session.id as string;
    await current.app.close();
    store.close();
    current = undefined;
  }

  // Simulate the on-disk transcript Claude would have written for that session.
  const projDir = join(claudeHome, ".claude", "projects", encodeProjectDir(sessionCwd));
  await mkdir(projDir, { recursive: true });
  await writeFile(
    join(projDir, `${id}.jsonl`),
    JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: "earlier question" }] } }) +
      "\n" +
      JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "earlier answer" }] },
      }) +
      "\n",
    "utf8",
  );

  // Server 2: same db -> dormant session; GET /sessions/:id must project the jsonl into history frames.
  const store2 = openSessionStore({ dbPath });
  current = createServer(configFor(), managerFor(), { store: store2, history: new HistoryService({ claudeHome }) });
  const res = await current.app.inject({
    method: "GET",
    url: `/sessions/${id}`,
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  expect(res.statusCode).toBe(200);
  const history = res.json().history as { kind: string; payload: { type: string } }[];
  expect(history).toHaveLength(2);
  expect(history.every((f) => f.kind === "event")).toBe(true);
  expect(history.map((f) => f.payload.type)).toEqual(["user", "assistant"]);
});
