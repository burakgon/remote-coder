import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, test } from "vitest";
import { SessionManager, SessionHub, inMemoryFrameSpool } from "../src/index.js";
import type { FrameSpool, ServerFrame } from "../src/index.js";
import type { TranscriptTurn } from "@remote-coder/protocol";

const MOCK = fileURLToPath(new URL("./helpers/mock-claude-interactive.mjs", import.meta.url));
function managerFor(mode: string): SessionManager {
  return new SessionManager(
    { claudeBin: process.execPath },
    { spawnPrefixArgs: [MOCK], baseEnv: { ...process.env, MOCK_MODE: mode }, startTimeoutMs: 5000 },
  );
}

const NOW = 10_000_000_000;
const RECENT = NOW - 60_000; // within the recovery window so a rehydrated lost session is kept

/** A minimal HistoryService double — getHistory reads transcript turns from this map by session id. */
function fakeHistory(turns: Record<string, TranscriptTurn[]>): {
  read: (cwd: string, id: string) => Promise<TranscriptTurn[]>;
  readSubagents: () => TranscriptTurn[];
  resolveTranscriptPath: (cwd: string, id: string) => string | undefined;
  transcriptPath: () => string;
} {
  return {
    read: async (_cwd, id) => turns[id] ?? [],
    readSubagents: () => [],
    resolveTranscriptPath: (_cwd, id) => ((turns[id]?.length ?? 0) > 0 ? `/fake/${id}.jsonl` : undefined),
    transcriptPath: () => "/fake",
  };
}

/** A tiny in-memory SessionStore double seeded with one RECENT dormant row for `id`. */
function storeWith(id: string, lastActivityAt = RECENT) {
  const rows = [{ id, cwd: "/work", dangerouslySkip: false, status: "dormant", createdAt: RECENT - 1, lastActivityAt }];
  return {
    list: () => rows,
    delete: () => void rows.splice(0, rows.length),
    upsert: () => {},
    get: (k: string) => rows.find((r) => r.id === k),
    setStatus: () => {},
    touch: () => {},
    close: () => {},
    mode: "memory-fallback" as const,
  };
}

function userTurn(uuid: string, text: string): TranscriptTurn {
  return { type: "user", uuid, message: { role: "user", content: [{ type: "text", text }] } } as TranscriptTurn;
}
function spoolEvent(seq: number, type: "user" | "assistant", uuid: string | undefined, text: string): ServerFrame {
  return {
    seq,
    kind: "event",
    payload: { type, ...(uuid !== undefined ? { uuid } : {}), message: { content: [{ type: "text", text }] } },
  };
}

let spool: FrameSpool;
beforeEach(() => {
  spool = inMemoryFrameSpool();
});
afterEach(() => {
  spool.close();
});

/** Resolve once a frame matching `pred` arrives on the subscription. */
function waitForFrame(hub: SessionHub, id: string, pred: (f: ServerFrame) => boolean): Promise<ServerFrame> {
  return new Promise((resolve) => {
    const sub = hub.subscribe(id, (f) => {
      if (pred(f)) {
        sub.unsubscribe();
        resolve(f);
      }
    });
  });
}

test("the hub spools a live turn's content-bearing frames (not stream_event deltas); result clears it", async () => {
  const hub = new SessionHub(managerFor("simple"), { spool });
  const meta = await hub.createSession({ cwd: process.cwd() });
  const done = waitForFrame(hub, meta.id, (f) => f.kind === "result");
  hub.sendMessage(meta.id, "hi");
  await done;
  // The result CLEARS the spool (the turn is now durable), so after a completed turn nothing is spooled.
  expect(spool.read(meta.id)).toEqual([]);
  hub.stopSession(meta.id);
});

test("result clears the spool; a NEW in-flight frame after it re-populates the spool", async () => {
  const hub = new SessionHub(managerFor("simple"), { spool });
  const meta = await hub.createSession({ cwd: process.cwd() });
  const done = waitForFrame(hub, meta.id, (f) => f.kind === "result");
  hub.sendMessage(meta.id, "hi");
  await done;
  expect(spool.read(meta.id)).toEqual([]);

  // A new content-bearing frame for the NEXT turn (an attachment goes through the same emit path and is a
  // critical/spoolable kind) repopulates the spool — proving the clear only resets the boundary.
  hub.pushAttachment(meta.id, { id: "att-1", path: "/tmp/x", name: "x", isImage: false });
  const read = spool.read(meta.id);
  expect(read).toHaveLength(1);
  expect(read[0]!.kind).toBe("attachment");
  hub.stopSession(meta.id);
});

test("write → simulated restart → reopen RECOVERS the spooled in-flight turn (merged into history)", async () => {
  const id = "sess-recover";
  // Pre-seed the spool as if a prior process had spooled an in-flight turn the transcript never captured.
  // seq <= sinceSeq (sinceSeq is the empty rehydrated buffer's maxSeq = 0).
  spool.append(id, spoolEvent(0, "assistant", "a-inflight", "half a thought"));
  spool.append(id, { seq: 0, kind: "permission", payload: { requestId: "perm-1", toolName: "Write" } });

  const history = fakeHistory({}); // transcript LOST (empty) for this id
  const hub = new SessionHub(managerFor("simple"), {
    spool,
    history: history as never,
    store: storeWith(id) as never,
    now: () => NOW,
  });
  hub.loadFromStore();
  expect(hub.getSession(id)).toBeDefined(); // kept (recoverable content + recent), not pruned

  const { history: frames } = await hub.getHistory(id);
  expect(frames.some((f) => f.kind === "event" && (f.payload as { uuid?: string }).uuid === "a-inflight")).toBe(true);
  expect(frames.some((f) => f.kind === "permission")).toBe(true);
});

test("NO duplication on reopen: a spooled frame the transcript ALREADY has is not re-added", async () => {
  const id = "sess-dedupe";
  // The transcript HAS the user turn (uuid u-1). The spool also has it PLUS a newer assistant turn the
  // transcript still lacks. Both spooled frames carry uuids (required for spooling now) and seq <= 0.
  spool.append(id, spoolEvent(0, "user", "u-1", "the question"));
  spool.append(id, spoolEvent(0, "assistant", "a-2", "the in-flight reply"));

  const history = fakeHistory({ [id]: [userTurn("u-1", "the question")] });
  const hub = new SessionHub(managerFor("simple"), {
    spool,
    history: history as never,
    store: storeWith(id) as never,
    now: () => NOW,
  });
  hub.loadFromStore();

  const { history: frames } = await hub.getHistory(id);
  const userFrames = frames.filter((f) => (f.payload as { uuid?: string }).uuid === "u-1");
  expect(userFrames).toHaveLength(1); // transcript copy only; the spooled duplicate is reconciled away
  expect(frames.some((f) => (f.payload as { uuid?: string }).uuid === "a-2")).toBe(true); // new tail recovered
});

// ── CRITICAL-1 / HIGH-1: the no-uuid live echo must NEVER be spooled (it can't dedup → duplicate bubble)
test("CRITICAL-1: a uuid-less live user/assistant echo is NOT spooled (only uuid-bearing events are)", () => {
  const id = "no-uuid";
  spool.append(id, spoolEvent(0, "user", undefined, "the live echo with no uuid"));
  spool.append(id, spoolEvent(0, "assistant", undefined, "a uuid-less assistant frame"));
  spool.append(id, spoolEvent(0, "user", "u-9", "the uuid-bearing copy"));
  const read = spool.read(id);
  // Only the uuid-bearing event survived; the two uuid-less echoes were rejected at append.
  expect(read).toHaveLength(1);
  expect((read[0]!.payload as { uuid: string }).uuid).toBe("u-9");
});

// ── CRITICAL-2: the race window — a spooled frame with seq > sinceSeq is delivered by the WS replay, so
// it must NOT be merged into history too (that would double-count; the assistant path has no uuid dedup).
test("CRITICAL-2: mergeSpool contributes only spooled frames with seq <= sinceSeq (WS replay covers the rest)", async () => {
  const id = "race";
  // A session that ran a live turn so its buffer has a real maxSeq (= sinceSeq). Drive one turn.
  const hub = new SessionHub(managerFor("simple"), { spool });
  const meta = await hub.createSession({ cwd: process.cwd() });
  const done = waitForFrame(hub, meta.id, (f) => f.kind === "result");
  hub.sendMessage(meta.id, "hi");
  await done;
  // The result cleared the spool; sinceSeq is the buffer's max.
  const sinceSeq = (await hub.getHistory(meta.id)).sinceSeq;
  expect(sinceSeq).toBeGreaterThan(0);

  // Now seed the spool with a LOST frame (seq <= sinceSeq → the transcript-missing tail) and a RACE frame
  // (seq > sinceSeq → emitted during the await; the WS `?since=sinceSeq` replay re-delivers it).
  spool.append(meta.id, spoolEvent(sinceSeq, "assistant", "lost-tail", "the genuinely lost tail"));
  spool.append(meta.id, spoolEvent(sinceSeq + 5, "assistant", "race-frame", "arrived during the await"));

  // No transcript wired (buffer-fallback path) → mergeSpool runs over the buffer snapshot.
  const { history: frames } = await hub.getHistory(meta.id);
  expect(frames.some((f) => (f.payload as { uuid?: string }).uuid === "lost-tail")).toBe(true); // recovered
  expect(frames.some((f) => (f.payload as { uuid?: string }).uuid === "race-frame")).toBe(false); // NOT merged
  void id;
  hub.stopSession(meta.id);
});

// ── MEDIUM-1: retention bound — a stale transcript-less session is dropped + its spool cleared; a recent
// one is kept.
test("MEDIUM-1: pruneDeadSessions drops a STALE transcript-less session and clears its spool; keeps a recent one", () => {
  const recentId = "recent-lost";
  const staleId = "stale-lost";
  spool.append(recentId, spoolEvent(0, "assistant", "r-1", "recent lost tail"));
  spool.append(staleId, spoolEvent(0, "assistant", "s-1", "stale lost tail"));

  const rows = [
    {
      id: recentId,
      cwd: "/w",
      dangerouslySkip: false,
      status: "dormant" as const,
      createdAt: 1,
      lastActivityAt: RECENT,
    },
    { id: staleId, cwd: "/w", dangerouslySkip: false, status: "dormant" as const, createdAt: 1, lastActivityAt: 1 },
  ];
  const store = {
    list: () => rows,
    delete: (k: string) => {
      const i = rows.findIndex((r) => r.id === k);
      if (i >= 0) rows.splice(i, 1);
    },
    upsert: () => {},
    get: (k: string) => rows.find((r) => r.id === k),
    setStatus: () => {},
    touch: () => {},
    close: () => {},
    mode: "memory-fallback" as const,
  };
  const history = fakeHistory({}); // neither has a transcript
  const hub = new SessionHub(managerFor("simple"), {
    spool,
    history: history as never,
    store: store as never,
    now: () => NOW,
  });
  hub.loadFromStore();
  // loadFromStore already prunes the stale one (never-used createdAt==lastActivityAt). The recent one is kept.
  expect(hub.getSession(recentId)).toBeDefined();
  expect(hub.getSession(staleId)).toBeUndefined();
  expect(spool.read(staleId)).toEqual([]); // its spool was cleared (no zombie file)
  expect(spool.read(recentId).length).toBeGreaterThan(0); // recent one's spool retained

  // And a later pruneDeadSessions doesn't drop the recent one (still within the window).
  hub.pruneDeadSessions();
  expect(hub.getSession(recentId)).toBeDefined();
});

test("MEDIUM-1: pruneDeadSessions evicts a session whose activity AGES PAST the recovery window", () => {
  const id = "ages-out";
  spool.append(id, spoolEvent(0, "assistant", "a", "tail"));
  // RECENT at boot → kept.
  const hub = new SessionHub(managerFor("simple"), {
    spool,
    history: fakeHistory({}) as never,
    store: storeWith(id) as never,
    now: () => NOW,
  });
  hub.loadFromStore();
  expect(hub.getSession(id)).toBeDefined();
  // Time advances WAY past the window with no transcript ever appearing → the next prune evicts it.
  const hub2 = new SessionHub(managerFor("simple"), {
    spool,
    history: fakeHistory({}) as never,
    store: storeWith(id) as never,
    now: () => NOW + 1000 * 60 * 60 * 24 * 30, // +30 days
  });
  hub2.loadFromStore();
  hub2.pruneDeadSessions();
  expect(hub2.getSession(id)).toBeUndefined();
  expect(spool.read(id)).toEqual([]); // spool cleared on eviction
});

test("deleteSession drops the session's spool", async () => {
  const hub = new SessionHub(managerFor("simple"), { spool });
  const meta = await hub.createSession({ cwd: process.cwd() });
  spool.append(meta.id, { seq: 0, kind: "permission", payload: { requestId: "p1" } });
  expect(spool.read(meta.id).length).toBeGreaterThan(0);
  hub.deleteSession(meta.id);
  expect(spool.read(meta.id)).toEqual([]);
});
