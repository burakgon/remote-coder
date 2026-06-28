import { describe, expect, it } from "vitest";
import { anyTurnInFlight } from "./turn-in-flight";
import { emptyView } from "../store/frame-reducer";
import type { SessionView } from "../store/frame-reducer";
import type { LiveWireState } from "../ui/LiveWire";

function view(wireState: LiveWireState): SessionView {
  return { ...emptyView(), wireState };
}

describe("anyTurnInFlight (OTA drain gating)", () => {
  it("is false for no sessions", () => {
    expect(anyTurnInFlight({})).toBe(false);
  });

  it("is false when every session is idle / dormant / done", () => {
    expect(anyTurnInFlight({ a: view("idle"), b: view("dormant"), c: view("success") })).toBe(false);
  });

  it("is true when ANY session is actively working (thinking / streaming / running-tool)", () => {
    expect(anyTurnInFlight({ a: view("idle"), b: view("thinking") })).toBe(true);
    expect(anyTurnInFlight({ a: view("streaming") })).toBe(true);
    expect(anyTurnInFlight({ a: view("idle"), b: view("idle"), c: view("running-tool") })).toBe(true);
  });

  it("does NOT count an 'awaiting' session (paused on the user, not producing — a restart there re-surfaces the prompt)", () => {
    expect(anyTurnInFlight({ a: view("awaiting") })).toBe(false);
  });

  it("does NOT count an 'error' session", () => {
    expect(anyTurnInFlight({ a: view("error") })).toBe(false);
  });
});
