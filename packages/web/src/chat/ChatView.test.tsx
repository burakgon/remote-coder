import { render, screen, act, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatView } from "./ChatView";
import { useStore } from "../store/store";
import type { ApiClient } from "../api/client";
import type { ServerFrame, SessionMeta } from "../types/server";

// jsdom provides a real WebSocket constructor that attempts to connect to the fake host and then
// fires async open/error/close events — those land outside act() and trigger the socket hook's
// status setState. Replace it with an inert stub so the socket is created and closed cleanly with
// no asynchronous state updates leaking past the test (this task does not exercise live frames).
class InertWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readyState = InertWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send() {}
  close() {}
}

let realWebSocket: typeof WebSocket;
beforeEach(() => {
  realWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = InertWebSocket as unknown as typeof WebSocket;
});

const session: SessionMeta = { id: "s1", cwd: "/home/u/proj", dangerouslySkip: false, status: "running", createdAt: 1 };

const history: ServerFrame[] = [
  { seq: 1, kind: "event", payload: { type: "assistant", message: { content: [{ type: "text", text: "Hello from history" }] } } },
  { seq: 2, kind: "result", payload: { type: "result", result: "All set", permissionDenials: [] } },
];

function apiStub(): ApiClient {
  return {
    listSessions: vi.fn(),
    getSession: vi.fn(async () => ({ session, history })),
    createSession: vi.fn(),
    stopSession: vi.fn(),
    listDir: vi.fn(),
    uploadFile: vi.fn(),
    downloadUrl: () => "",
  } as unknown as ApiClient;
}

afterEach(() => {
  // Unmount inside act() so the live socket's teardown (effect cleanup) is flushed within an
  // act-wrapped scope — otherwise the unmount's final state settle warns about an update outside act.
  act(() => {
    cleanup();
  });
  useStore.setState({ views: {} });
  globalThis.WebSocket = realWebSocket;
});

describe("ChatView", () => {
  async function renderSettled(api: ApiClient) {
    const utils = render(<ChatView session={session} api={api} token="t" />);
    // Flush the mount effect's async history load (getSession → applyFrames) inside act() so the
    // resulting store update + re-render are wrapped and no update leaks past the test.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    return utils;
  }

  it("loads history into the store and renders it", async () => {
    await renderSettled(apiStub());
    // Every replayed frame is applied in a single store update, flushed inside act() above.
    expect(screen.getByText(/all set/i)).toBeInTheDocument();
    expect(screen.getByText(/hello from history/i)).toBeInTheDocument();
  });

  it("shows the session cwd in the header", async () => {
    await renderSettled(apiStub());
    expect(screen.getByText("/home/u/proj")).toBeInTheDocument();
  });

  it("the live-wire header reflects the session state (awaiting when a permission is pending)", async () => {
    await renderSettled(apiStub());

    // Drive a permission frame through the store; the header's LiveWire must move to "awaiting" (iris).
    act(() => {
      useStore.getState().applyFrame(session.id, {
        seq: 99,
        kind: "permission",
        payload: { requestId: "r1", kind: "can_use_tool", toolName: "Write" },
      });
    });

    const wire = await screen.findByRole("status");
    expect(wire).toHaveAttribute("data-state", "awaiting");
  });
});
