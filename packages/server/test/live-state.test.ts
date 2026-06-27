import { describe, expect, test } from "vitest";
import { liveStateFromBuffer } from "../src/index.js";
import type { ServerFrame } from "../src/index.js";

let seq = 0;
const f = (kind: ServerFrame["kind"], payload: unknown): ServerFrame => ({ seq: ++seq, kind, payload });
// A per-turn assistant usage; its sum is the CURRENT context occupancy (the meter numerator).
const PER_TURN = {
  input_tokens: 2,
  cache_read_input_tokens: 574510,
  cache_creation_input_tokens: 855,
  output_tokens: 794,
};
const PER_TURN_SUM = 2 + 574510 + 855 + 794; // 576161
const assistant = (usage?: object) =>
  f("event", { type: "assistant", message: { content: [{ type: "text", text: "hi" }], ...(usage ? { usage } : {}) } });
const streamDelta = () => f("event", { type: "stream_event", event: { type: "content_block_delta" } });
const userEv = () => f("event", { type: "user", message: { content: "go" } });
const systemInit = () => f("event", { type: "system", subtype: "init" });
// The result event's usage carries the authoritative contextWindow (its contextTokens are cumulative and
// deliberately ignored — see liveStateFromBuffer).
const result = (usage?: object) => f("result", { type: "result", ...(usage ? { usage } : {}) });

describe("liveStateFromBuffer", () => {
  test("turnActive=false when the newest frame is a result (turn ended)", () => {
    const live = liveStateFromBuffer([userEv(), assistant(PER_TURN), result({ contextWindow: 1_000_000 })]);
    expect(live.turnActive).toBe(false);
    // contextTokens from the assistant's per-turn usage; contextWindow from the result.
    expect(live.usage).toEqual({ contextTokens: PER_TURN_SUM, contextWindow: 1_000_000 });
  });

  test("contextTokens is the per-turn assistant usage, NOT the result's cumulative usage", () => {
    // Result reports a huge cumulative contextTokens — it must be ignored (only contextWindow is taken).
    const live = liveStateFromBuffer([
      assistant(PER_TURN),
      result({ contextTokens: 7_997_608, contextWindow: 1_000_000 }),
    ]);
    expect(live.usage?.contextTokens).toBe(PER_TURN_SUM); // 576k, not 8M
    expect(live.usage?.contextWindow).toBe(1_000_000);
  });

  test("turnActive=true when assistant/stream activity comes AFTER the last result", () => {
    const live = liveStateFromBuffer([result({ contextWindow: 200000 }), userEv(), assistant(PER_TURN), streamDelta()]);
    expect(live.turnActive).toBe(true);
    expect(live.usage).toEqual({ contextTokens: PER_TURN_SUM, contextWindow: 200000 });
  });

  test("a SUBAGENT assistant message does not set the main contextTokens", () => {
    const sub = f("event", {
      type: "assistant",
      parentToolUseId: "ag1",
      message: { content: [], usage: { input_tokens: 999999 } },
    });
    const live = liveStateFromBuffer([sub, assistant(PER_TURN), result({ contextWindow: 1_000_000 })]);
    expect(live.usage?.contextTokens).toBe(PER_TURN_SUM); // the main turn's, not the subagent's
  });

  test("turnActive=true mid-first-turn (no result yet); contextWindow absent", () => {
    const live = liveStateFromBuffer([userEv(), assistant(PER_TURN), streamDelta()]);
    expect(live.turnActive).toBe(true);
    expect(live.usage).toEqual({ contextTokens: PER_TURN_SUM });
  });

  test("a pending permission/question counts as an active (awaiting) turn", () => {
    const live = liveStateFromBuffer([result({ contextWindow: 200000 }), f("permission", { requestId: "r" })]);
    expect(live.turnActive).toBe(true);
  });

  test("an exit after a turn means not active", () => {
    const live = liveStateFromBuffer([assistant(PER_TURN), f("exit", { code: 0 })]);
    expect(live.turnActive).toBe(false);
  });

  test("a lone system init is NOT a turn", () => {
    expect(liveStateFromBuffer([systemInit()]).turnActive).toBe(false);
  });

  test("empty buffer → idle, no usage", () => {
    expect(liveStateFromBuffer([])).toEqual({ turnActive: false });
  });
});
