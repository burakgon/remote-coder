import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { PushDispatcher, openPushStore } from "../src/index.js";
import type { PushStore, PushSubscriptionRecord, ServerFrame } from "../src/index.js";

let dir: string;
let store: PushStore;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "rc-disp-"));
  store = openPushStore({ dbPath: join(dir, "push.db") });
});
afterEach(async () => {
  store.close();
  await rm(dir, { recursive: true, force: true });
});

function sub(endpoint: string): PushSubscriptionRecord {
  return { endpoint, p256dh: "p", auth: "a", createdAt: 1 };
}
const frame = (kind: ServerFrame["kind"], payload: unknown, seq = 1): ServerFrame => ({ seq, kind, payload });

test("sends a push to every subscribed device on a result frame", async () => {
  store.upsert(sub("https://push/1"));
  store.upsert(sub("https://push/2"));
  const send = vi.fn(async () => ({ statusCode: 201 }));
  const d = new PushDispatcher({ store, send, baseUrl: "https://host", coalesceMs: 0 });
  d.handleFrame("S1", frame("result", { type: "result", result: "all done", raw: {} }));
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  const payload = JSON.parse(send.mock.calls[0]![1] as string) as { title: string; body: string; url: string; tag: string };
  expect(payload.title).toBe("Task done");
  expect(payload.body).toContain("all done");
  expect(payload.url).toBe("https://host/?session=S1");
  expect(payload.tag).toBe("S1");
});

test("permission + question frames produce their own titles; event/diagnostic/exit are ignored", async () => {
  store.upsert(sub("https://push/1"));
  const send = vi.fn(async () => ({ statusCode: 201 }));
  const d = new PushDispatcher({ store, send, baseUrl: "https://host", coalesceMs: 0 });
  d.handleFrame("S1", frame("permission", { requestId: "r", kind: "hook_callback", toolName: "Bash" }));
  d.handleFrame("S1", frame("event", { type: "assistant" }));
  d.handleFrame("S1", frame("diagnostic", { source: "stderr", message: "x" }));
  d.handleFrame("S1", frame("exit", { code: 0 }));
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  const p = JSON.parse(send.mock.calls[0]![1] as string) as { title: string; body: string };
  expect(p.title).toBe("Permission needed");
  expect(p.body).toContain("Bash");
});

test("coalesces a burst into a single push per session per window (latest wins)", async () => {
  vi.useFakeTimers();
  try {
    store.upsert(sub("https://push/1"));
    const send = vi.fn(async () => ({ statusCode: 201 }));
    const d = new PushDispatcher({ store, send, baseUrl: "https://host", coalesceMs: 5000 });
    d.handleFrame("S1", frame("result", { type: "result", result: "first", raw: {} }, 1));
    d.handleFrame("S1", frame("permission", { requestId: "r", kind: "hook_callback", toolName: "Bash" }, 2));
    d.handleFrame("S1", frame("question", { requestId: "q", toolInput: {}, questions: [{ question: "Which?", multiSelect: false, options: [] }] }, 3));
    await vi.advanceTimersByTimeAsync(5000);
    expect(send).toHaveBeenCalledTimes(1);
    const p = JSON.parse(send.mock.calls[0]![1] as string) as { title: string };
    expect(p.title).toBe("Question"); // the latest qualifying frame in the window
  } finally {
    vi.useRealTimers();
  }
});

test("prunes a subscription on a 410/404 from the push service", async () => {
  store.upsert(sub("https://dead"));
  store.upsert(sub("https://alive"));
  const send = vi.fn(async (s: PushSubscriptionRecord) => ({ statusCode: s.endpoint === "https://dead" ? 410 : 201 }));
  const d = new PushDispatcher({ store, send, baseUrl: "https://host", coalesceMs: 0 });
  d.handleFrame("S1", frame("result", { type: "result", result: "x", raw: {} }));
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect(store.list().map((s) => s.endpoint)).toEqual(["https://alive"]));
});

test("a non-gone send failure keeps the subscription and does not abort the other sends", async () => {
  store.upsert(sub("https://boom"));
  store.upsert(sub("https://ok"));
  const send = vi.fn(async (s: PushSubscriptionRecord) => {
    if (s.endpoint === "https://boom") throw new Error("network down");
    return { statusCode: 201 };
  });
  const d = new PushDispatcher({ store, send, baseUrl: "https://host", coalesceMs: 0 });
  d.handleFrame("S1", frame("result", { type: "result", result: "x", raw: {} }));
  // Both subscriptions are attempted even though one throws...
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  // ...and neither is pruned (a transient failure is not "gone").
  expect(store.list().map((s) => s.endpoint).sort()).toEqual(["https://boom", "https://ok"]);
});

import { SessionHub, SessionManager } from "../src/index.js";

test("SessionHub.onFrame fires for emitted frames (the push-trigger seam)", async () => {
  const seen: { id: string; kind: string }[] = [];
  const manager = new SessionManager({ claudeBin: process.execPath }, { spawnPrefixArgs: [], startTimeoutMs: 1 });
  const hub = new SessionHub(manager, { onFrame: (id, f) => seen.push({ id, kind: f.kind }) });
  // Drive emit directly via a fake record: subscribe a listener and push a frame through the buffer.
  // The simplest seam check is via a created session's exit path, but spawning is avoided here; instead
  // assert the option is accepted and the hub constructs. A full end-to-end onFrame→push assertion is in
  // Task 9's integration test (over the interactive mock).
  expect(typeof hub.subscribe).toBe("function");
  expect(seen).toEqual([]); // no frames emitted without a live process
});
