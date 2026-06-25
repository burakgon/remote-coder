import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, test } from "vitest";
import { SessionManager, SessionHub, openSessionStore } from "../src/index.js";
import { HistoryService } from "../src/history-service.js";

// loadFromStore() must PRUNE dead sessions at boot so the rail never shows a session that does nothing
// when tapped — the bug a server restart (e.g. an OTA update) surfaced: every stored session was
// rehydrated as "dormant", including ones whose turn never landed (no transcript → un-resumable).
// "Dead" = NO resumable transcript on disk. Status is NOT the signal: an errored session that still has
// a transcript is resumable and is kept.

const MOCK = fileURLToPath(new URL("./helpers/mock-claude-interactive.mjs", import.meta.url));
function managerFor(mode: string): SessionManager {
  // loadFromStore is metadata-only (never spawns), so the mock manager is never actually invoked here.
  return new SessionManager(
    { claudeBin: process.execPath },
    { spawnPrefixArgs: [MOCK], baseEnv: { ...process.env, MOCK_MODE: mode }, startTimeoutMs: 5000 },
  );
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "rc-prune-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Write a non-empty transcript at the exact path HistoryService reads from. */
async function writeTranscript(history: HistoryService, cwd: string, id: string): Promise<void> {
  const p = history.transcriptPath(cwd, id);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, '{"type":"user","message":{"content":[{"type":"text","text":"hi"}]}}\n');
}

test("loadFromStore prunes sessions with no transcript and keeps resumable ones (incl. resumable errored)", async () => {
  const store = openSessionStore({ dbPath: ":memory:" });
  const history = new HistoryService({ claudeHome: dir });

  await writeTranscript(history, "/work/live", "live-1"); // dormant + transcript → resumable
  await writeTranscript(history, "/work/err", "err-1"); // errored + transcript → still resumable

  store.upsert({ id: "live-1", cwd: "/work/live", dangerouslySkip: false, status: "dormant", createdAt: 1, lastActivityAt: 2 });
  store.upsert({ id: "err-1", cwd: "/work/err", dangerouslySkip: false, status: "errored", createdAt: 1, lastActivityAt: 2 });
  // dead-1 / dead-2: NO transcript on disk → can't resume → dead, whatever the stored status.
  store.upsert({ id: "dead-1", cwd: "/work/dead1", dangerouslySkip: false, status: "dormant", createdAt: 1, lastActivityAt: 2 });
  store.upsert({ id: "dead-2", cwd: "/work/dead2", dangerouslySkip: false, status: "errored", createdAt: 1, lastActivityAt: 2 });

  const hub = new SessionHub(managerFor("simple"), { store, history });
  hub.loadFromStore();

  // Both resumable sessions rehydrate (errored → dormant: a transient crash gets another chance).
  expect(hub.listSessions().map((s) => s.id).sort()).toEqual(["err-1", "live-1"]);
  expect(hub.getSession("err-1")?.status).toBe("dormant");
  // The un-resumable rows are pruned from the durable store (gone for good, not just hidden).
  expect(store.get("live-1")).toBeDefined();
  expect(store.get("err-1")).toBeDefined();
  expect(store.get("dead-1")).toBeUndefined();
  expect(store.get("dead-2")).toBeUndefined();
  store.close();
});

test("loadFromStore keeps everything when no HistoryService is configured (can't verify → never prune)", () => {
  const store = openSessionStore({ dbPath: ":memory:" });
  store.upsert({ id: "keep-1", cwd: "/work/x", dangerouslySkip: false, status: "dormant", createdAt: 1, lastActivityAt: 2 });
  const hub = new SessionHub(managerFor("simple"), { store }); // no history
  hub.loadFromStore();
  expect(hub.listSessions().map((s) => s.id)).toContain("keep-1");
  store.close();
});
