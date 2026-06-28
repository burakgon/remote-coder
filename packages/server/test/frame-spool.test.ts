import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { openFrameSpool, inMemoryFrameSpool, isSpoolable, spoolFrameIdentity, SPOOL_CAP } from "../src/index.js";
import type { FrameSpool } from "../src/index.js";
import type { ServerFrame } from "../src/index.js";

function ev(uuid: string, type: "assistant" | "user" | "stream_event" | "system" = "assistant"): ServerFrame {
  return { seq: 0, kind: "event", payload: { type, uuid, message: { content: [{ type: "text", text: uuid }] } } };
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "rc-spool-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("isSpoolable / spoolFrameIdentity (pure)", () => {
  test("spools critical kinds + UUID-BEARING assistant/user events, NOT stream_event/system/diagnostic/exit", () => {
    expect(isSpoolable(ev("a", "assistant"))).toBe(true);
    expect(isSpoolable(ev("u", "user"))).toBe(true);
    expect(isSpoolable(ev("s", "stream_event"))).toBe(false); // the perf-sensitive flood is excluded
    expect(isSpoolable(ev("y", "system"))).toBe(false);
    // CRITICAL-1: a uuid-LESS user/assistant event (the real CLI's live prompt echo) is NOT spoolable —
    // it can't be deduped against the uuid-bearing transcript, so spooling it would duplicate on reopen.
    expect(isSpoolable({ seq: 0, kind: "event", payload: { type: "user", message: { content: "hi" } } })).toBe(false);
    expect(isSpoolable({ seq: 0, kind: "event", payload: { type: "assistant", message: { content: [] } } })).toBe(
      false,
    );
    expect(isSpoolable({ seq: 0, kind: "result", payload: {} })).toBe(true);
    expect(isSpoolable({ seq: 0, kind: "permission", payload: { requestId: "p1" } })).toBe(true);
    expect(isSpoolable({ seq: 0, kind: "question", payload: { requestId: "q1" } })).toBe(true);
    expect(isSpoolable({ seq: 0, kind: "attachment", payload: { id: "f1" } })).toBe(true);
    expect(isSpoolable({ seq: 0, kind: "rewound", payload: { checkpointId: "c1" } })).toBe(true);
    expect(isSpoolable({ seq: 0, kind: "resolve", payload: { requestId: "p1" } })).toBe(true);
    expect(isSpoolable({ seq: 0, kind: "diagnostic", payload: { source: "parser", message: "x" } })).toBe(false);
    expect(isSpoolable({ seq: 0, kind: "exit", payload: { code: 0 } })).toBe(false);
  });

  test("identity keys events by uuid and prompts/attachments/rewound by their id", () => {
    expect(spoolFrameIdentity(ev("u-1"))).toBe("event:u-1");
    expect(spoolFrameIdentity({ seq: 0, kind: "permission", payload: { requestId: "p" } })).toBe("permission:p");
    expect(spoolFrameIdentity({ seq: 0, kind: "question", payload: { requestId: "q" } })).toBe("question:q");
    expect(spoolFrameIdentity({ seq: 0, kind: "resolve", payload: { requestId: "q" } })).toBe("resolve:q");
    expect(spoolFrameIdentity({ seq: 0, kind: "attachment", payload: { id: "f" } })).toBe("attachment:f");
    expect(spoolFrameIdentity({ seq: 0, kind: "rewound", payload: { checkpointId: "c" } })).toBe("rewound:c");
    // No stable id → undefined (the merge keeps such a frame rather than dropping recovered content).
    expect(spoolFrameIdentity({ seq: 0, kind: "event", payload: { type: "assistant" } })).toBeUndefined();
  });
});

/** Run the contract suite against both the file-backed and in-memory implementations. */
function contractTests(name: string, make: () => FrameSpool): void {
  describe(name, () => {
    test("append → read returns content-bearing frames oldest→newest; stream_event is skipped", () => {
      const spool = make();
      spool.append("s1", ev("a"));
      spool.append("s1", ev("delta", "stream_event")); // filtered out
      spool.append("s1", ev("b"));
      const read = spool.read("s1");
      expect(read.map((f) => (f.payload as { uuid: string }).uuid)).toEqual(["a", "b"]);
      spool.close();
    });

    test("clear drops a session's whole spool (the result boundary)", () => {
      const spool = make();
      spool.append("s1", ev("a"));
      expect(spool.read("s1")).toHaveLength(1);
      spool.clear("s1");
      expect(spool.read("s1")).toEqual([]);
      spool.close();
    });

    test("list reports only sessions with non-empty spools", () => {
      const spool = make();
      spool.append("a", ev("x"));
      spool.append("b", ev("y"));
      spool.clear("b");
      expect(spool.list().sort()).toEqual(["a"]);
      spool.close();
    });

    test("bounded: a runaway turn is capped to the newest SPOOL_CAP frames", () => {
      const spool = make();
      const total = SPOOL_CAP + 50;
      for (let i = 0; i < total; i++) spool.append("s1", ev(`f${i}`));
      const read = spool.read("s1");
      expect(read).toHaveLength(SPOOL_CAP);
      // The OLDEST were dropped — the newest tail survives (most useful to recover).
      expect((read[0]!.payload as { uuid: string }).uuid).toBe(`f${total - SPOOL_CAP}`);
      expect((read[read.length - 1]!.payload as { uuid: string }).uuid).toBe(`f${total - 1}`);
      spool.close();
    });
  });
}

contractTests("inMemoryFrameSpool", () => inMemoryFrameSpool());
contractTests("openFrameSpool (file-backed)", () => openFrameSpool({ dir }));

describe("openFrameSpool (file-backed) durability", () => {
  test("survives a simulated restart: a fresh spool over the SAME dir reads prior content", () => {
    const a = openFrameSpool({ dir });
    a.append("s1", ev("a"));
    a.append("s1", { seq: 0, kind: "permission", payload: { requestId: "p1" } });
    a.close(); // the process "dies"

    const b = openFrameSpool({ dir }); // a new process boots over the same dir
    const read = b.read("s1");
    expect(read.map((f) => f.kind)).toEqual(["event", "permission"]);
    b.close();
  });

  test("tolerates a torn trailing line (a crash mid-append)", async () => {
    const a = openFrameSpool({ dir });
    a.append("s1", ev("a"));
    a.close();
    // Simulate a half-written line appended by a crash.
    await writeFile(join(dir, "s1.jsonl"), (await readFile(join(dir, "s1.jsonl"), "utf8")) + '{"seq":0,"kind":"ev');
    const b = openFrameSpool({ dir });
    const read = b.read("s1");
    expect(read).toHaveLength(1); // the complete line is recovered; the torn one is skipped
    expect((read[0]!.payload as { uuid: string }).uuid).toBe("a");
    b.close();
  });

  test("a hostile session id never escapes the spool dir (no-op)", () => {
    const spool = openFrameSpool({ dir });
    spool.append("../escape", ev("a"));
    expect(spool.read("../escape")).toEqual([]);
    expect(spool.list()).toEqual([]);
    spool.close();
  });

  // MEDIUM-2: a long non-terminating turn never reaches a `result` (which clears the spool) and may never
  // be reopened (which compacts on read), so `append` MUST enforce the cap itself or the on-disk file grows
  // unbounded. Many appends with NO intervening read keep the file bounded to ~2×SPOOL_CAP lines.
  test("append bounds the on-disk file even with NO read (long unreopened turn can't grow unbounded)", async () => {
    const spool = openFrameSpool({ dir });
    const total = SPOOL_CAP * 5; // far past the cap
    for (let i = 0; i < total; i++) spool.append("s1", ev(`f${i}`));
    // Read the RAW file directly (not via spool.read, which would itself compact) to prove the on-disk size.
    const lines = (await readFile(join(dir, "s1.jsonl"), "utf8")).split("\n").filter(Boolean);
    expect(lines.length).toBeLessThanOrEqual(2 * SPOOL_CAP);
    // And the retained content is still the newest tail (the most useful to recover).
    const read = spool.read("s1");
    expect(read).toHaveLength(SPOOL_CAP);
    expect((read[read.length - 1]!.payload as { uuid: string }).uuid).toBe(`f${total - 1}`);
    spool.close();
  });
});
