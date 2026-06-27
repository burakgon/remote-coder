import { describe, expect, test } from "vitest";
import { liveStateFromBuffer } from "../src/index.js";
import type { ServerFrame } from "../src/index.js";

let seq = 0;
const f = (kind: ServerFrame["kind"], payload: unknown): ServerFrame => ({ seq: ++seq, kind, payload });
const assistant = () => f("event", { type: "assistant", message: { content: [{ type: "text", text: "hi" }] } });
const streamDelta = () => f("event", { type: "stream_event", event: { type: "content_block_delta" } });
const userEv = () => f("event", { type: "user", message: { content: "go" } });
const systemInit = () => f("event", { type: "system", subtype: "init" });
const result = (usage?: unknown) => f("result", { type: "result", ...(usage ? { usage } : {}) });

describe("liveStateFromBuffer", () => {
  test("turnActive=false when the newest frame is a result (turn ended)", () => {
    const live = liveStateFromBuffer([userEv(), assistant(), result({ contextTokens: 1000 })]);
    expect(live.turnActive).toBe(false);
    expect(live.usage).toEqual({ contextTokens: 1000 });
  });

  test("turnActive=true when assistant/stream activity comes AFTER the last result", () => {
    const live = liveStateFromBuffer([result({ contextTokens: 500 }), userEv(), assistant(), streamDelta()]);
    expect(live.turnActive).toBe(true);
    // usage is still the most-recent result's (the in-flight turn hasn't produced one yet)
    expect(live.usage).toEqual({ contextTokens: 500 });
  });

  test("turnActive=true mid-first-turn (no result yet); usage absent", () => {
    const live = liveStateFromBuffer([userEv(), assistant(), streamDelta()]);
    expect(live.turnActive).toBe(true);
    expect(live.usage).toBeUndefined();
  });

  test("a pending permission/question counts as an active (awaiting) turn", () => {
    const live = liveStateFromBuffer([result(), f("permission", { requestId: "r" })]);
    expect(live.turnActive).toBe(true);
  });

  test("an exit after a turn means not active", () => {
    const live = liveStateFromBuffer([assistant(), f("exit", { code: 0 })]);
    expect(live.turnActive).toBe(false);
  });

  test("a lone system init is NOT a turn", () => {
    expect(liveStateFromBuffer([systemInit()]).turnActive).toBe(false);
  });

  test("empty buffer → idle, no usage", () => {
    expect(liveStateFromBuffer([])).toEqual({ turnActive: false });
  });
});
