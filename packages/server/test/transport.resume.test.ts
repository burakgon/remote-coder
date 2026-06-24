import { fileURLToPath } from "node:url";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { WebSocket } from "ws";
import { SessionManager, createServer } from "../src/index.js";
import type { ServerRuntimeConfig, CreateServerResult, ServerFrame } from "../src/index.js";

const MOCK = fileURLToPath(new URL("./helpers/mock-claude-interactive.mjs", import.meta.url));
const TOKEN = "test-token";
const auth = { authorization: `Bearer ${TOKEN}` };

function configFor(): ServerRuntimeConfig {
  return {
    port: 0,
    bindAddress: "127.0.0.1",
    accessToken: TOKEN,
    fsRoot: process.cwd(),
    maxUploadBytes: 26214400,
    claude: { claudeBin: process.execPath },
  };
}

function managerFor(mode: string, config: ServerRuntimeConfig) {
  return new SessionManager(config.claude, {
    spawnPrefixArgs: [MOCK],
    baseEnv: { ...process.env, MOCK_MODE: mode },
    startTimeoutMs: 5000,
  });
}

let projectsDir: string;
let current: CreateServerResult | undefined;

beforeEach(async () => {
  projectsDir = await mkdtemp(join(tmpdir(), "rc-resume-"));
});
afterEach(async () => {
  if (current) await current.app.close();
  current = undefined;
  await rm(projectsDir, { recursive: true, force: true });
});

// The resume flow spawns `claude` (the mock) with cwd === the transcript's cwd, so it must be a REAL
// directory on disk or the spawn ENOENTs. Use the test process cwd.
const REAL_CWD = process.cwd();

/** Write a transcript for `id` under a project dir; the cwd must be a real directory (spawn target). */
async function writeTranscript(id: string, cwd: string = REAL_CWD): Promise<void> {
  const dir = join(projectsDir, "-work-proj");
  await mkdir(dir, { recursive: true });
  const lines = [
    JSON.stringify({ type: "user", cwd, gitBranch: "main", message: { role: "user", content: [{ type: "text", text: "first question" }] } }),
    JSON.stringify({ type: "assistant", cwd, message: { role: "assistant", model: "m", content: [{ type: "text", text: "first answer" }] } }),
    JSON.stringify({ type: "user", cwd, message: { role: "user", content: [{ type: "text", text: "second question" }] } }),
    JSON.stringify({ type: "assistant", cwd, message: { role: "assistant", model: "m", content: [{ type: "text", text: "second answer" }] } }),
  ].join("\n");
  await writeFile(join(dir, `${id}.jsonl`), lines);
}

function makeServer(mode: string): CreateServerResult {
  const config = configFor();
  return createServer(config, managerFor(mode, config), { projectsDir });
}

async function listen(result: CreateServerResult): Promise<string> {
  const address = await result.app.listen({ port: 0, host: "127.0.0.1" });
  return address.replace(/^http/, "ws");
}

// --- GET /resumable --------------------------------------------------------

test("GET /resumable is token-gated", async () => {
  await writeTranscript("sess-1");
  current = makeServer("resume");
  const res = await current.app.inject({ method: "GET", url: "/resumable" });
  expect(res.statusCode).toBe(401);
});

test("GET /resumable lists past sessions (recent-first shape)", async () => {
  await writeTranscript("sess-1");
  current = makeServer("resume");
  const res = await current.app.inject({ method: "GET", url: "/resumable", headers: auth });
  expect(res.statusCode).toBe(200);
  const sessions = res.json().sessions as Array<{ sessionId: string; cwd: string; summary: string; messageCount: number; gitBranch?: string; lastActivity: number }>;
  expect(sessions).toHaveLength(1);
  expect(sessions[0]).toMatchObject({
    sessionId: "sess-1",
    cwd: REAL_CWD,
    gitBranch: "main",
    summary: "first question",
    messageCount: 4,
  });
  expect(typeof sessions[0].lastActivity).toBe("number");
});

test("GET /resumable?cwd= filters", async () => {
  await writeTranscript("sess-1", REAL_CWD);
  current = makeServer("resume");
  const hit = await current.app.inject({
    method: "GET",
    url: `/resumable?cwd=${encodeURIComponent(REAL_CWD)}`,
    headers: auth,
  });
  expect(hit.json().sessions).toHaveLength(1);
  const miss = await current.app.inject({ method: "GET", url: "/resumable?cwd=/other", headers: auth });
  expect(miss.json().sessions).toHaveLength(0);
});

// --- POST /sessions { resumeSessionId } ------------------------------------

test("resume create returns 404 when the transcript is missing", async () => {
  current = makeServer("resume");
  const res = await current.app.inject({
    method: "POST",
    url: "/sessions",
    headers: auth,
    payload: { resumeSessionId: "does-not-exist" },
  });
  expect(res.statusCode).toBe(404);
});

test("resume create spawns under the resumed id with the transcript cwd", async () => {
  await writeTranscript("resume-me");
  current = makeServer("resume");
  const res = await current.app.inject({
    method: "POST",
    url: "/sessions",
    headers: auth,
    payload: { resumeSessionId: "resume-me" },
  });
  expect(res.statusCode).toBe(201);
  const session = res.json().session;
  expect(session.id).toBe("resume-me"); // id === resumeSessionId
  expect(session.cwd).toBe(REAL_CWD); // cwd from the transcript, not the request
  expect(session.status).toBe("running");

  // It is listed as a live session.
  const listed = await current.app.inject({ method: "GET", url: "/sessions", headers: auth });
  expect(listed.json().sessions.map((s: { id: string }) => s.id)).toContain("resume-me");
});

test("resume is idempotent: a second resume of a live id returns it (200)", async () => {
  await writeTranscript("dup-id");
  current = makeServer("resume");
  const first = await current.app.inject({
    method: "POST",
    url: "/sessions",
    headers: auth,
    payload: { resumeSessionId: "dup-id" },
  });
  expect(first.statusCode).toBe(201);
  const second = await current.app.inject({
    method: "POST",
    url: "/sessions",
    headers: auth,
    payload: { resumeSessionId: "dup-id" },
  });
  expect(second.statusCode).toBe(200);
  expect(second.json().session.id).toBe("dup-id");
  // Only one live session under that id.
  const listed = await current.app.inject({ method: "GET", url: "/sessions", headers: auth });
  expect(listed.json().sessions.filter((s: { id: string }) => s.id === "dup-id")).toHaveLength(1);
});

test("a resumed session's WS replay contains the prior history exactly once", async () => {
  await writeTranscript("hist-id");
  current = makeServer("resume");
  const base = await listen(current);

  await current.app.inject({
    method: "POST",
    url: "/sessions",
    headers: auth,
    payload: { resumeSessionId: "hist-id" },
  });

  // Connect a WS client; the replay must carry the four prior turns from the transcript.
  const frames = await new Promise<ServerFrame[]>((resolve, reject) => {
    const collected: ServerFrame[] = [];
    const ws = new WebSocket(`${base}/sessions/hist-id/ws?token=${TOKEN}`);
    ws.on("message", (data: Buffer) => collected.push(JSON.parse(data.toString())));
    // The replay is sent synchronously on connect; give it a tick then read it back.
    ws.on("open", () => setTimeout(() => { ws.close(); resolve(collected); }, 300));
    ws.on("error", reject);
  });

  // Extract the user/assistant text turns from the injected event frames.
  const texts: string[] = [];
  for (const f of frames) {
    if (f.kind !== "event") continue;
    const ev = f.payload as { type?: string; message?: { content?: Array<{ type?: string; text?: string }> } };
    if (ev.type !== "user" && ev.type !== "assistant") continue;
    for (const block of ev.message?.content ?? []) {
      if (block.type === "text" && typeof block.text === "string") texts.push(block.text);
    }
  }

  // All four prior turns are present...
  expect(texts).toContain("first question");
  expect(texts).toContain("first answer");
  expect(texts).toContain("second answer");
  // ...and each EXACTLY once (the resumed claude does not re-emit prior history; only the suppressed
  // warm-up pair, which never reaches the buffer).
  expect(texts.filter((t) => t === "first question")).toHaveLength(1);
  expect(texts.filter((t) => t === "second answer")).toHaveLength(1);
  // The synthetic warm-up text is suppressed by claude-process and never injected.
  expect(texts).not.toContain("Continue from where you left off.");
  expect(texts).not.toContain("No response requested.");
});
