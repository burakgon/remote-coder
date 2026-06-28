import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { act } from "react";
import { useSessionSocket } from "./use-session-socket";
import type { OutboundFrame, SessionMeta } from "../types/server";

// A controllable fake WebSocket capturing outbound frames; the test drives open/visibility.
class FakeWS {
  static last: FakeWS | undefined;
  static OPEN = 1;
  OPEN = 1;
  readyState = 1; // open immediately so send() forwards
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: OutboundFrame[] = [];
  url: string;
  constructor(url: string) {
    this.url = url;
    FakeWS.last = this;
  }
  send(data: string) {
    this.sent.push(JSON.parse(data) as OutboundFrame);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

const session: SessionMeta = { id: "s1", cwd: "/p/s1", dangerouslySkip: false, status: "running", createdAt: 1 };

function visibilityFrames(ws: FakeWS): OutboundFrame[] {
  return ws.sent.filter((f) => f.type === "visibility");
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("useSessionSocket visibility (foreground-gating)", () => {
  beforeEach(() => {
    FakeWS.last = undefined;
    vi.stubGlobal("WebSocket", FakeWS as unknown as typeof WebSocket);
    setVisibility("visible");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the current visibility right after the socket opens", () => {
    const { result } = renderHook(() => useSessionSocket(session, "t", true));
    const ws = FakeWS.last!;
    act(() => ws.onopen?.());
    const vis = visibilityFrames(ws);
    expect(vis.at(-1)).toEqual({ type: "visibility", state: "foreground" });
    expect(result.current.status).toBe("open");
  });

  it("sends background on visibilitychange→hidden and foreground on →visible", () => {
    renderHook(() => useSessionSocket(session, "t", true));
    const ws = FakeWS.last!;
    act(() => ws.onopen?.());
    act(() => setVisibility("hidden"));
    expect(visibilityFrames(ws).at(-1)).toEqual({ type: "visibility", state: "background" });
    act(() => setVisibility("visible"));
    expect(visibilityFrames(ws).at(-1)).toEqual({ type: "visibility", state: "foreground" });
  });

  it("does not connect or send when disabled (history not loaded)", () => {
    renderHook(() => useSessionSocket(session, "t", false));
    expect(FakeWS.last).toBeUndefined();
  });
});
