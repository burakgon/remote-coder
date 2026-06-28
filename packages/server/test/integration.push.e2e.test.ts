import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { WebSocket } from "ws";
import {
  SessionManager,
  createServer,
  openSessionStore,
  openIdempotencyStore,
  openPushStore,
  HistoryService,
  PushDispatcher,
} from "../src/index.js";
import type { CreateServerResult, ServerRuntimeConfig, ServerFrame, PushStore } from "../src/index.js";

const MOCK = fileURLToPath(new URL("./helpers/mock-claude-interactive.mjs", import.meta.url));
const TOKEN = "push-int-token";
const ENDPOINT = "https://push/device";

let dir: string;
let current: CreateServerResult | undefined;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "rc-pushint-"));
});
afterEach(async () => {
  if (current) await current.app.close();
  current = undefined;
  await rm(dir, { recursive: true, force: true });
});

function configFor(): ServerRuntimeConfig {
  return {
    port: 0,
    bindAddress: "127.0.0.1",
    accessToken: TOKEN,
    fsRoot: process.cwd(),
    maxUploadBytes: 26214400,
    dataDir: dir,
    claude: { claudeBin: process.execPath },
  };
}
const auth = { authorization: `Bearer ${TOKEN}` };

/**
 * Stand up the REAL wired server (createServer) with a FAKE push `send` injected into a real
 * PushDispatcher, driving a real interactive mock session. No real Web Push, no external network,
 * no real `claude`. The injected `send` controls the dispatch outcome (a 201 dispatches, a 410 prunes).
 */
function standUp(pushStore: PushStore, send: PushSendFn): { dispatcher: PushDispatcher; server: CreateServerResult } {
  // Wire the REAL hub's foreground-gate + awaiting-count into the dispatcher (mirrors start.ts). The hub is
  // built inside createServer, so a mutable holder is filled after it returns; until then the predicates no-op.
  const hubRef: { hub?: CreateServerResult["hub"] } = {};
  const dispatcher = new PushDispatcher({
    store: pushStore,
    send,
    baseUrl: "https://host",
    coalesceMs: 0,
    hasForegroundSubscriber: (id) => hubRef.hub?.hasForegroundSubscriber(id) ?? false,
    awaitingCount: () => hubRef.hub?.awaitingSessionCount() ?? 0,
  });
  const manager = new SessionManager(
    { claudeBin: process.execPath },
    { spawnPrefixArgs: [MOCK], baseEnv: { ...process.env, MOCK_MODE: "simple" }, startTimeoutMs: 5000 },
  );
  const server = createServer(configFor(), manager, {
    store: openSessionStore({ dbPath: join(dir, "s.db") }),
    idempotency: openIdempotencyStore({ dbPath: join(dir, "i.db") }),
    history: new HistoryService(),
    pushStore,
    vapidPublicKey: "PUBKEY",
    onFrame: (id: string, frame: ServerFrame) => dispatcher.handleFrame(id, frame),
  });
  hubRef.hub = server.hub;
  return { dispatcher, server };
}

type PushSendFn = (sub: unknown, payload: string) => Promise<{ statusCode: number }>;

test("subscribe via REST -> a completed turn pushes the session deep link to the registered device", async () => {
  const pushStore = openPushStore({ dbPath: join(dir, "push.db") });
  // Injected send — asserts dispatch WITHOUT a real Web Push. coalesceMs 0 = send immediately.
  const send = vi.fn<PushSendFn>(async () => ({ statusCode: 201 }));
  const { server } = standUp(pushStore, send);
  current = server;

  // (1) Register the device via the REAL token-gated REST route (not a direct store write).
  const sub = await current.app.inject({
    method: "POST",
    url: "/push/subscribe",
    headers: auth,
    payload: { endpoint: ENDPOINT, keys: { p256dh: "p", auth: "a" } },
  });
  expect(sub.statusCode).toBe(201);
  expect(pushStore.list().map((s) => s.endpoint)).toEqual([ENDPOINT]);

  const created = await current.app.inject({
    method: "POST",
    url: "/sessions",
    headers: auth,
    payload: { cwd: process.cwd() },
  });
  expect(created.statusCode).toBe(201);
  const id = created.json().session.id as string;

  // (2) Drive one real turn over the in-process hub: the mock emits a `result` frame, which flows
  // through emit -> onFrame -> dispatcher.handleFrame -> send.
  await current.hub.sendMessage(id, "hello");

  // (3) The fake send fires to the subscribed device with the correct deep-link payload.
  await vi.waitFor(() => expect(send).toHaveBeenCalled(), { timeout: 8000 });
  expect(send.mock.calls[0]![0]).toMatchObject({ endpoint: ENDPOINT });
  const payload = JSON.parse(send.mock.calls[0]![1]) as { url: string; tag: string };
  expect(payload.url).toBe(`https://host/?session=${id}`);
  expect(payload.tag).toBe(id);

  pushStore.close();
}, 20000);

test("FOREGROUND-GATING e2e: a turn does NOT push while a foreground WS client is viewing that session; it DOES when backgrounded", async () => {
  const pushStore = openPushStore({ dbPath: join(dir, "push.db") });
  pushStore.upsert({ endpoint: ENDPOINT, p256dh: "p", auth: "a", createdAt: 1 });
  const send = vi.fn<PushSendFn>(async () => ({ statusCode: 201 }));
  const { server } = standUp(pushStore, send);
  current = server;
  // Stand up a real listener so a real WS client (a foreground subscriber) can connect.
  const httpUrl = await server.app.listen({ port: 0, host: "127.0.0.1" });
  const base = httpUrl.replace(/^http/, "ws");

  const created = await server.app.inject({
    method: "POST",
    url: "/sessions",
    headers: auth,
    payload: { cwd: process.cwd() },
  });
  const id = created.json().session.id as string;

  // (1) A foreground WS client connects (default foreground) and STAYS connected.
  const ws = new WebSocket(`${base}/sessions/${id}/ws?token=${encodeURIComponent(TOKEN)}`);
  await new Promise<void>((resolve, reject) => {
    ws.on("open", () => resolve());
    ws.on("error", reject);
    setTimeout(() => reject(new Error("foreground ws never opened")), 6000);
  });
  await vi.waitFor(() => expect(server.hub.hasForegroundSubscriber(id)).toBe(true));

  // A turn completes while the user is LOOKING at this session → NO push (you're already here).
  await server.hub.sendMessage(id, "hello while looking");
  await new Promise((r) => setTimeout(r, 400)); // give the (coalesceMs 0) dispatch a chance
  expect(send).not.toHaveBeenCalled();

  // (2) The user backgrounds the tab (visibility frame) — the session now has no foreground viewer.
  ws.send(JSON.stringify({ type: "visibility", state: "background" }));
  await vi.waitFor(() => expect(server.hub.hasForegroundSubscriber(id)).toBe(false));

  // A turn now DOES push (the user isn't looking — that's the whole async value prop).
  await server.hub.sendMessage(id, "hello while away");
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1), { timeout: 8000 });
  expect(send.mock.calls[0]![0]).toMatchObject({ endpoint: ENDPOINT });

  ws.close();
  pushStore.close();
}, 20000);

test("a 410 Gone from the send prunes the subscription (a later frame does not re-send to it)", async () => {
  const pushStore = openPushStore({ dbPath: join(dir, "push.db") });
  pushStore.upsert({ endpoint: ENDPOINT, p256dh: "p", auth: "a", createdAt: 1 });

  // First send returns 410 (device gone) -> the dispatcher must prune it from the store.
  const send = vi.fn<PushSendFn>(async () => ({ statusCode: 410 }));
  const { server } = standUp(pushStore, send);
  current = server;

  const created = await current.app.inject({
    method: "POST",
    url: "/sessions",
    headers: auth,
    payload: { cwd: process.cwd() },
  });
  const id = created.json().session.id as string;

  // First turn -> result frame -> send returns 410 -> prune.
  await current.hub.sendMessage(id, "first");
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1), { timeout: 8000 });

  // The 410 pruned the subscription out of the store entirely.
  await vi.waitFor(() => expect(pushStore.list()).toEqual([]), { timeout: 8000 });

  // A SECOND real frame must NOT re-send: there is no longer any subscription to dispatch to.
  await current.hub.sendMessage(id, "second");
  // Give the second result frame time to flow through the (coalesceMs 0) dispatcher.
  await new Promise((r) => setTimeout(r, 250));
  expect(send).toHaveBeenCalledTimes(1);

  pushStore.close();
}, 20000);

test("the whole /push/* namespace 401s without a token", async () => {
  const pushStore = openPushStore({ dbPath: join(dir, "push.db") });
  const send = vi.fn<PushSendFn>(async () => ({ statusCode: 201 }));
  const { server } = standUp(pushStore, send);
  current = server;

  for (const r of [
    { method: "GET" as const, url: "/push/vapid" },
    {
      method: "POST" as const,
      url: "/push/subscribe",
      payload: { endpoint: ENDPOINT, keys: { p256dh: "p", auth: "a" } },
    },
    { method: "POST" as const, url: "/push/unsubscribe", payload: { endpoint: ENDPOINT } },
  ]) {
    const res = await current.app.inject(r);
    expect(res.statusCode, `${r.method} ${r.url} must 401 without a token`).toBe(401);
  }
  // The unauthenticated subscribe attempt left the store untouched.
  expect(pushStore.list()).toEqual([]);

  pushStore.close();
});
