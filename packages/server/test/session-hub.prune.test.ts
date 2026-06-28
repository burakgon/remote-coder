import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, test } from "vitest";
import { SessionManager, SessionHub, openSessionStore, SPOOL_RECOVERY_TTL_MS } from "../src/index.js";
import { HistoryService } from "../src/history-service.js";

// DURABILITY contract (revised): a turn's content lives only in the in-memory buffer until Claude
// transcribes it to disk, so a crash/OTA-restart caught mid-turn can leave a session with NO transcript
// even though it had real activity. loadFromStore must therefore NOT hard-delete a transcript-less
// session that had ANY activity (lastActivityAt > createdAt) — the user must still see it existed and a
// later resume may revive it; the critical-frame spool recovers the in-flight content on reopen. The ONE
// narrow drop that remains: a CREATED-BUT-NEVER-USED session (no transcript AND no recorded activity,
// lastActivityAt <= createdAt) — a stray create whose turn was never sent has nothing to show/resume.
// Status is NOT the signal: an errored session with a transcript is still resumable and rehydrates as
// dormant.

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

test("loadFromStore keeps resumable sessions + RECENT transcript-less sessions that HAD activity; drops never-used + STALE", async () => {
  const store = openSessionStore({ dbPath: ":memory:" });
  const history = new HistoryService({ claudeHome: dir });
  // Fixed clock so the recovery-window retention math is deterministic.
  const NOW = 10_000_000_000;
  const recent = NOW - 60_000; // 1 min ago → within SPOOL_RECOVERY_TTL_MS

  await writeTranscript(history, "/work/live", "live-1"); // dormant + transcript → resumable
  await writeTranscript(history, "/work/err", "err-1"); // errored + transcript → still resumable

  store.upsert({
    id: "live-1",
    cwd: "/work/live",
    dangerouslySkip: false,
    status: "dormant",
    createdAt: recent - 1,
    lastActivityAt: recent,
  });
  store.upsert({
    id: "err-1",
    cwd: "/work/err",
    dangerouslySkip: false,
    status: "errored",
    createdAt: recent - 1,
    lastActivityAt: recent,
  });
  // lost-1 / lost-2: NO transcript on disk, but they HAD activity recently (a crash/OTA-restart ate the
  // turn before Claude transcribed it). DURABILITY: keep them — the user must see the session existed; a
  // later resume / the spool recovers content. Status is not the signal.
  store.upsert({
    id: "lost-1",
    cwd: "/work/lost1",
    dangerouslySkip: false,
    status: "dormant",
    createdAt: recent - 1,
    lastActivityAt: recent,
  });
  store.upsert({
    id: "lost-2",
    cwd: "/work/lost2",
    dangerouslySkip: false,
    status: "errored",
    createdAt: recent - 1,
    lastActivityAt: recent,
  });
  // never-1: created but NEVER used (no transcript AND lastActivityAt <= createdAt) → a true dead row.
  store.upsert({
    id: "never-1",
    cwd: "/work/never1",
    dangerouslySkip: false,
    status: "dormant",
    createdAt: recent,
    lastActivityAt: recent,
  });
  // stale-1: had activity, but LONG ago (past the recovery window) and still no transcript → a zombie;
  // drop it so a crashed-then-abandoned session doesn't accumulate a rail row forever.
  store.upsert({
    id: "stale-1",
    cwd: "/work/stale1",
    dangerouslySkip: false,
    status: "dormant",
    createdAt: 1,
    lastActivityAt: NOW - SPOOL_RECOVERY_TTL_MS - 1,
  });

  const hub = new SessionHub(managerFor("simple"), { store, history, now: () => NOW });
  hub.loadFromStore();

  // Resumable AND RECENT activity-bearing-but-transcript-less sessions all rehydrate (errored → dormant:
  // a transient crash gets another chance). The never-used create and the STALE zombie are gone.
  expect(
    hub
      .listSessions()
      .map((s) => s.id)
      .sort(),
  ).toEqual(["err-1", "live-1", "lost-1", "lost-2"]);
  expect(hub.getSession("err-1")?.status).toBe("dormant");
  expect(hub.getSession("lost-2")?.status).toBe("dormant");
  // The kept rows stay in the store; the never-used create AND the stale zombie are pruned for good.
  expect(store.get("live-1")).toBeDefined();
  expect(store.get("err-1")).toBeDefined();
  expect(store.get("lost-1")).toBeDefined();
  expect(store.get("lost-2")).toBeDefined();
  expect(store.get("never-1")).toBeUndefined();
  expect(store.get("stale-1")).toBeUndefined();
  store.close();
});

test("pruneDeadSessions evicts a dormant session whose transcript vanished on the host — LIVE, no restart", async () => {
  const store = openSessionStore({ dbPath: ":memory:" });
  const history = new HistoryService({ claudeHome: dir });
  await writeTranscript(history, "/work/live", "live-1");
  await writeTranscript(history, "/work/gone", "gone-1");
  store.upsert({
    id: "live-1",
    cwd: "/work/live",
    dangerouslySkip: false,
    status: "dormant",
    createdAt: 1,
    lastActivityAt: 2,
  });
  store.upsert({
    id: "gone-1",
    cwd: "/work/gone",
    dangerouslySkip: false,
    status: "dormant",
    createdAt: 1,
    lastActivityAt: 2,
  });

  const hub = new SessionHub(managerFor("simple"), { store, history });
  hub.loadFromStore(); // both have transcripts → both rehydrate
  expect(
    hub
      .listSessions()
      .map((s) => s.id)
      .sort(),
  ).toEqual(["gone-1", "live-1"]);

  // The host closes/kills "gone-1" — its transcript disappears. It's now dead: can't `claude --resume`.
  await rm(history.transcriptPath("/work/gone", "gone-1"));
  hub.pruneDeadSessions();

  // Evicted live (no restart) — gone from the rail AND the durable store; the resumable one stays.
  expect(hub.listSessions().map((s) => s.id)).toEqual(["live-1"]);
  expect(store.get("gone-1")).toBeUndefined();
  expect(store.get("live-1")).toBeDefined();
  store.close();
});

test("loadFromStore keeps everything when no HistoryService is configured (can't verify → never prune)", () => {
  const store = openSessionStore({ dbPath: ":memory:" });
  store.upsert({
    id: "keep-1",
    cwd: "/work/x",
    dangerouslySkip: false,
    status: "dormant",
    createdAt: 1,
    lastActivityAt: 2,
  });
  const hub = new SessionHub(managerFor("simple"), { store }); // no history
  hub.loadFromStore();
  expect(hub.listSessions().map((s) => s.id)).toContain("keep-1");
  store.close();
});
