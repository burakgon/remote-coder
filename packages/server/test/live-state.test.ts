import { describe, expect, test } from "vitest";
import { liveStateFromBuffer, accumulateLiveTokens } from "../src/index.js";
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

  test("liveStateFromBuffer does NOT derive liveTokens (the buffer's assistant usage is initial-only)", () => {
    // Real CLI: the retained assistant frame carries output_tokens ~2 (the message_start value); the
    // accurate running count is in the never-buffered message_delta. So the buffer can't be the source.
    const live = liveStateFromBuffer([userEv(), assistant(PER_TURN), streamDelta()]);
    expect(live.liveTokens).toBeUndefined();
  });

  // liveWire — the HONEST reopen phase derived from retained tool_use/tool_result blocks (the buffer drops
  // stream_event, so this is the best phase signal: a tool genuinely running vs the model generating).
  const assistantTool = (id: string, name = "Bash") =>
    f("event", { type: "assistant", message: { content: [{ type: "tool_use", id, name, input: {} }] } });
  const userToolResult = (id: string) =>
    f("event", { type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] } });

  test("liveWire='running-tool' while a tool_use is UNMATCHED (a tool is executing)", () => {
    const live = liveStateFromBuffer([userEv(), assistantTool("t1")]);
    expect(live.turnActive).toBe(true);
    expect(live.liveWire).toBe("running-tool");
  });

  test("liveWire='thinking' once the tool_use is closed by its tool_result (model is generating again)", () => {
    const live = liveStateFromBuffer([assistantTool("t1"), userToolResult("t1")]);
    expect(live.turnActive).toBe(true);
    expect(live.liveWire).toBe("thinking");
  });

  test("liveWire='thinking' for a turn with NO tools yet (pure thinking/streaming) — never fabricates a tool", () => {
    const live = liveStateFromBuffer([userEv(), assistant(PER_TURN), streamDelta()]);
    expect(live.liveWire).toBe("thinking");
  });

  test("a Task/Agent spawn keeps liveWire='running-tool' until its tool_result (the subagent is a tool)", () => {
    const live = liveStateFromBuffer([assistantTool("ag1", "Task")]);
    expect(live.liveWire).toBe("running-tool");
  });

  test("liveWire is undefined when no turn is active (turn ended)", () => {
    const live = liveStateFromBuffer([assistant(PER_TURN), result({ contextWindow: 200000 })]);
    expect(live.turnActive).toBe(false);
    expect(live.liveWire).toBeUndefined();
  });

  test("tools from a PRIOR (already-resulted) turn don't count toward the current turn's phase", () => {
    // t1 ran and was answered, the turn ended (result), then a NEW turn started with no tools yet → thinking.
    const live = liveStateFromBuffer([
      assistantTool("t1"),
      userToolResult("t1"),
      result({ contextWindow: 200000 }),
      userEv(),
      assistant(PER_TURN),
    ]);
    expect(live.turnActive).toBe(true);
    expect(live.liveWire).toBe("thinking"); // the prior t1 is behind the boundary — not the current phase
  });
});

describe("accumulateLiveTokens (the live '· N tok' counter, sourced from stream message_delta)", () => {
  const start = (out: number) => ({
    type: "stream_event" as const,
    event: { type: "message_start", message: { usage: { output_tokens: out } } },
  });
  const delta = (out: number) => ({
    type: "stream_event" as const,
    event: { type: "message_delta", usage: { output_tokens: out } },
  });
  const fold = (evs: Array<Parameters<typeof accumulateLiveTokens>[1]>) =>
    evs.reduce((s, ev) => accumulateLiveTokens(s, ev), { liveTokens: 0, turnTokenBase: 0 });

  test("ticks up from message_delta's running output_tokens", () => {
    const s = fold([start(2), delta(120), delta(450)]);
    expect(s.liveTokens).toBe(450);
  });

  test("stays MONOTONIC across a multi-message (tool) turn — message_start commits the prior into the base", () => {
    // msg1: start 1 → delta 300; msg2 starts (base 300) → delta 180 → 480. (matches the real capture: 134→150)
    const s = fold([start(1), delta(300), start(2), delta(180)]);
    expect(s.turnTokenBase).toBe(300);
    expect(s.liveTokens).toBe(480);
  });

  test("IGNORES subagent stream deltas (their tokens belong to the subagent card)", () => {
    const subDelta = {
      type: "stream_event" as const,
      parentToolUseId: "ag1",
      event: { type: "message_delta", usage: { output_tokens: 9999 } },
    };
    const s = fold([start(1), delta(100), subDelta]);
    expect(s.liveTokens).toBe(100); // unchanged by the subagent delta
  });

  test("ignores non-stream events (assistant/result pass through unchanged)", () => {
    const s = accumulateLiveTokens({ liveTokens: 42, turnTokenBase: 0 }, { type: "assistant" });
    expect(s).toEqual({ liveTokens: 42, turnTokenBase: 0 });
  });
});
