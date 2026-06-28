import { mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync, unlinkSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { ServerFrame } from "./replay-buffer.js";
import { isCriticalKind } from "./replay-buffer.js";

/**
 * DURABILITY: a turn's streamed content lives only in the in-memory {@link ReplayBuffer} until Claude
 * transcribes it to its own `.jsonl` (whose fsync timing the server doesn't control). If the process
 * dies before that (crash / OTA restart / sleep-kill), the in-flight turn's content is lost — the
 * transcript hasn't captured it and the buffer is gone with the process.
 *
 * The FrameSpool is a small, append-only, per-session on-disk log of a session's CRITICAL frames so a
 * restart can recover the content the transcript hadn't yet captured. It is DELIBERATELY narrow to avoid
 * the prior perf regression (no sqlite write on every stream event, issue #27):
 *
 *   - It spools ONLY content-bearing frames (see {@link isSpoolable}): the critical kinds (permission /
 *     question / result / attachment / rewound / resolve) PLUS `assistant`/`user` message events — NEVER
 *     the flood of `stream_event` deltas. So an append happens a handful of times per turn, not per token.
 *   - Appends are cheap fs appends (one JSON line), not sqlite rows.
 *   - It is bounded: a session's spool holds at most {@link SPOOL_CAP} frames; over the cap the OLDEST
 *     are dropped (a giant turn can't grow it unbounded). Since we clear on `result`, it only ever holds
 *     the IN-FLIGHT tail anyway.
 *   - It is CLEARED when a turn completes (a `result` frame), so the spool only holds content the
 *     transcript may not yet have — never the whole finished conversation.
 *
 * On boot / getHistory, when the transcript is missing or shorter than the spool, the hub MERGES the
 * spooled frames (reconciled by identity — uuid / requestId — so a reopen never double-counts content the
 * transcript already has). See SessionHub.mergeSpool.
 */
export interface FrameSpool {
  /** Append a frame to a session's spool IF it is content-bearing (else a no-op). Best-effort. */
  append(sessionId: string, frame: ServerFrame): void;
  /** The session's currently-spooled frames, oldest→newest. Empty when nothing is spooled. */
  read(sessionId: string): ServerFrame[];
  /** Drop a session's whole spool (called on a turn `result`, and on deleteSession). Best-effort. */
  clear(sessionId: string): void;
  /** Session ids that currently have a non-empty spool (for boot recovery of unknown sessions). */
  list(): string[];
  /** Release any held resource (file handle / nothing for the in-memory double). */
  close(): void;
}

/** Max frames retained per session — bounds a runaway turn. We clear on `result`, so in practice the
 *  spool only ever holds the in-flight tail; this is the hard ceiling for a pathological non-terminating
 *  turn. Old frames are dropped first (the newest tail is the most useful to recover). */
export const SPOOL_CAP = 256;

/**
 * Whether a frame is worth spooling. We spool the critical kinds (they're the ones the ReplayBuffer
 * itself never evicts) PLUS `assistant`/`user` message events that CARRY A UUID — but NOT `stream_event`
 * deltas (the perf-sensitive flood; the final `assistant` frame carries the full text anyway) and not
 * bare `diagnostic`/`exit`/`event:system` frames (no recoverable conversation content).
 *
 * The uuid requirement is the CRITICAL dedup invariant: the merge reconciles a spooled event against the
 * transcript by uuid (see spoolFrameIdentity). The CLI's LIVE user-prompt echo is `{type:"user"}` with
 * NO uuid, while the TRANSCRIPT copy of that same prompt HAS a uuid — so a no-uuid spooled echo can never
 * be matched and would append a SECOND "You" bubble on reopen-mid-turn. The transcript reliably captures
 * user prompts, so dropping the no-uuid live echo from recovery is strictly better than duplicating it.
 * Assistant events always carry a uuid that matches the transcript, so they still spool and dedup cleanly.
 */
export function isSpoolable(frame: ServerFrame): boolean {
  if (isCriticalKind(frame.kind)) return true;
  if (frame.kind === "event") {
    const p = frame.payload as { type?: string; uuid?: unknown } | null;
    const t = p?.type;
    // Only spool message events with a uuid — a uuid-less live echo can't be deduped against the
    // transcript (which has uuids), so it must not enter the spool (it would duplicate on reopen).
    return (t === "assistant" || t === "user") && typeof p?.uuid === "string";
  }
  return false;
}

/**
 * A stable identity for a spooled frame so a merge can reconcile against transcript/buffer content and
 * never double-count. Events key on their `uuid` (the transcript carries the same uuid); prompt frames
 * (permission/question/resolve) on `requestId`; attachment/rewound on their own id/checkpointId. Returns
 * undefined when a frame has no stable id (it then can't be deduped — we keep it, accepting the small
 * risk over dropping recovered content).
 */
export function spoolFrameIdentity(frame: ServerFrame): string | undefined {
  const p = frame.payload as Record<string, unknown> | null;
  if (!p || typeof p !== "object") return undefined;
  if (frame.kind === "event") {
    return typeof p.uuid === "string" ? `event:${p.uuid}` : undefined;
  }
  if (frame.kind === "permission" || frame.kind === "question" || frame.kind === "resolve") {
    return typeof p.requestId === "string" ? `${frame.kind}:${p.requestId}` : undefined;
  }
  if (frame.kind === "attachment") return typeof p.id === "string" ? `attachment:${p.id}` : undefined;
  if (frame.kind === "rewound") return typeof p.checkpointId === "string" ? `rewound:${p.checkpointId}` : undefined;
  return undefined;
}

/** An in-memory FrameSpool double (tests / no data dir). NOT durable across a real process restart. */
export function inMemoryFrameSpool(): FrameSpool {
  const map = new Map<string, ServerFrame[]>();
  return {
    append: (sessionId, frame) => {
      if (!isSpoolable(frame)) return;
      const arr = map.get(sessionId) ?? [];
      arr.push(frame);
      if (arr.length > SPOOL_CAP) arr.splice(0, arr.length - SPOOL_CAP);
      map.set(sessionId, arr);
    },
    read: (sessionId) => [...(map.get(sessionId) ?? [])],
    clear: (sessionId) => void map.delete(sessionId),
    list: () => [...map.keys()].filter((id) => (map.get(id)?.length ?? 0) > 0),
    close: () => map.clear(),
  };
}

export interface OpenFrameSpoolOptions {
  /** Directory the per-session spool files live under (created if missing). */
  dir: string;
}

/** A session id must round-trip safely into a filename. Real claude session ids are uuids; this guards
 *  against a hostile/odd id traversing the spool dir. */
function spoolFileName(sessionId: string): string | undefined {
  if (!/^[A-Za-z0-9._-]+$/.test(sessionId)) return undefined;
  return `${sessionId}.jsonl`;
}

/**
 * The default file-backed FrameSpool: one append-only `<dir>/<sessionId>.jsonl` per session. Appends are
 * a single `appendFileSync` of one JSON line (cheap). `read` parses the file and applies the {@link
 * SPOOL_CAP} (keeping the newest tail); when a file exceeds the cap it is COMPACTED in place on read so
 * it can't grow without bound across a long-lived process. Synchronous (the hub's emit path is sync, and
 * these run a few times per turn — not per token). Every fs op is best-effort: a spool failure must never
 * unwind a claude emit (mirrors the store's spec §10 posture).
 */
export function openFrameSpool(opts: OpenFrameSpoolOptions): FrameSpool {
  const dir = opts.dir;
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch {
    // best-effort: if the dir can't be made, every op below degrades to a no-op via its own try/catch.
  }

  const pathFor = (sessionId: string): string | undefined => {
    const name = spoolFileName(sessionId);
    return name ? join(dir, name) : undefined;
  };

  // Per-session line count tracked across appends so a LONG non-terminating turn that's never reopened
  // can't grow the file on disk past the cap (read-time compaction alone wouldn't bound it). When the
  // count crosses ~2×SPOOL_CAP we compact the file down to the newest SPOOL_CAP lines. Lazily seeded from
  // the file on the first append (so a restart picks up the existing length).
  const lineCount = new Map<string, number>();

  const readRaw = (path: string): ServerFrame[] => {
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      return [];
    }
    const frames: ServerFrame[] = [];
    for (const line of text.split("\n")) {
      if (!line) continue;
      try {
        frames.push(JSON.parse(line) as ServerFrame);
      } catch {
        // skip a torn/partial trailing line (a crash mid-append) — the rest is still recoverable
      }
    }
    return frames;
  };

  /** Compact a session's file down to the newest SPOOL_CAP lines and reset its tracked count. */
  const compact = (sessionId: string, path: string): void => {
    const frames = readRaw(path);
    const tail = frames.length > SPOOL_CAP ? frames.slice(frames.length - SPOOL_CAP) : frames;
    try {
      const tmp = `${path}.tmp`;
      writeFileSync(tmp, tail.length > 0 ? tail.map((f) => JSON.stringify(f)).join("\n") + "\n" : "");
      renameSync(tmp, path);
      lineCount.set(sessionId, tail.length);
    } catch {
      // couldn't compact — leave the file; a later read/append retries
    }
  };

  return {
    append: (sessionId, frame) => {
      if (!isSpoolable(frame)) return;
      const path = pathFor(sessionId);
      if (!path) return;
      try {
        appendFileSync(path, JSON.stringify(frame) + "\n");
      } catch {
        // best-effort: a failed spool append must never unwind the claude emit (spec §10)
        return;
      }
      // BOUND on the append side too: a long non-terminating turn never reaches a `result` (which clears
      // the spool) and may never be reopened (which compacts on read), so without this the file grows
      // unbounded on disk. Track the count (seeded from the file on first touch) and compact when it
      // crosses ~2×SPOOL_CAP — amortized so the compaction cost is paid once per SPOOL_CAP appends.
      let n = lineCount.get(sessionId);
      if (n === undefined)
        n = readRaw(path).length; // includes the just-appended line
      else n += 1;
      lineCount.set(sessionId, n);
      if (n > 2 * SPOOL_CAP) compact(sessionId, path);
    },
    read: (sessionId) => {
      const path = pathFor(sessionId);
      if (!path) return [];
      const frames = readRaw(path);
      if (frames.length <= SPOOL_CAP) {
        lineCount.set(sessionId, frames.length);
        return frames;
      }
      // Over the cap: keep the newest tail and COMPACT the file in place (atomic rename) so it can't keep
      // growing across a long-lived process. Compaction is best-effort; the in-memory tail is returned
      // regardless.
      const tail = frames.slice(frames.length - SPOOL_CAP);
      try {
        const tmp = `${path}.tmp`;
        writeFileSync(tmp, tail.map((f) => JSON.stringify(f)).join("\n") + "\n");
        renameSync(tmp, path);
        lineCount.set(sessionId, tail.length);
      } catch {
        // couldn't compact — fine, the next read retries; return the capped tail anyway
      }
      return tail;
    },
    clear: (sessionId) => {
      lineCount.delete(sessionId);
      const path = pathFor(sessionId);
      if (!path) return;
      try {
        unlinkSync(path);
      } catch {
        // already gone / never existed — nothing to do
      }
    },
    list: () => {
      let names: string[];
      try {
        names = readdirSync(dir);
      } catch {
        return [];
      }
      const ids: string[] = [];
      for (const n of names) {
        if (!n.endsWith(".jsonl")) continue;
        const id = n.slice(0, -".jsonl".length);
        // Only report ids with actual content (an empty/leftover file isn't recoverable).
        try {
          if (readFileSync(join(dir, n), "utf8").trim().length > 0) ids.push(id);
        } catch {
          // unreadable — skip
        }
      }
      return ids;
    },
    close: () => {
      // No persistent handle to release (each op opens/closes its own fd).
    },
  };
}
