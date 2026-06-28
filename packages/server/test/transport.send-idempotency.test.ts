import { fileURLToPath } from "node:url";
import { afterEach, expect, test, vi } from "vitest";
import { WebSocket } from "ws";
import { SessionManager, createServer } from "../src/index.js";
import type { ServerRuntimeConfig, CreateServerResult } from "../src/index.js";

// SEND IDEMPOTENCY (#9): a re-delivered WS `user` frame (the client's reconnect queue re-sends a buffered
// message carrying the SAME msgId) must reach Claude AT MOST ONCE. Different msgIds are independent.

const MOCK = fileURLToPath(new URL("./helpers/mock-claude-interactive.mjs", import.meta.url));
const TOKEN = "send-idem-token";

function configFor(): ServerRuntimeConfig {
  return {
    port: 0,
    bindAddress: "127.0.0.1",
    accessToken: TOKEN,
    fsRoot: process.cwd(),
    maxUploadBytes: 26214400,
    dataDir: process.cwd(),
    claude: { claudeBin: process.execPath },
  };
}
function managerFor() {
  return new SessionManager(
    { claudeBin: process.execPath },
    { spawnPrefixArgs: [MOCK], baseEnv: { ...process.env, MOCK_MODE: "simple" }, startTimeoutMs: 5000 },
  );
}

let current: CreateServerResult | undefined;
afterEach(async () => {
  if (current) await current.app.close();
  current = undefined;
});

async function listen(result: CreateServerResult): Promise<string> {
  const address = await result.app.listen({ port: 0, host: "127.0.0.1" });
  return address.replace(/^http/, "ws");
}
async function createSession(result: CreateServerResult): Promise<string> {
  const created = await result.app.inject({
    method: "POST",
    url: "/sessions",
    headers: { authorization: `Bearer ${TOKEN}` },
    payload: { cwd: process.cwd() },
  });
  return created.json().session.id;
}
function openWs(base: string, id: string): WebSocket {
  return new WebSocket(`${base}/sessions/${id}/ws?token=${encodeURIComponent(TOKEN)}`);
}

/** Open a socket, run `drive` once it's open, wait a beat for the server to process, then resolve. */
async function withSocket(base: string, id: string, drive: (ws: WebSocket) => void, settleMs = 800): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const ws = openWs(base, id);
    ws.on("open", () => {
      drive(ws);
      setTimeout(() => {
        ws.close();
        resolve();
      }, settleMs);
    });
    ws.on("error", reject);
    setTimeout(() => reject(new Error("ws never opened")), 6000);
  });
}

test("same msgId twice → exactly ONE sendMessage to the manager", async () => {
  const config = configFor();
  current = createServer(config, managerFor());
  const base = await listen(current);
  const id = await createSession(current);
  // Spy on the hub's sendMessage — the WS user handler routes through it.
  const spy = vi.spyOn(current.hub, "sendMessage");

  await withSocket(base, id, (ws) => {
    ws.send(JSON.stringify({ type: "user", text: "force push?", msgId: "dup-1" }));
    ws.send(JSON.stringify({ type: "user", text: "force push?", msgId: "dup-1" })); // reconnect re-send
  });

  const calls = spy.mock.calls.filter(([sid]) => sid === id);
  expect(calls).toHaveLength(1);
  spy.mockRestore();
});

test("different msgIds → TWO sendMessage calls", async () => {
  const config = configFor();
  current = createServer(config, managerFor());
  const base = await listen(current);
  const id = await createSession(current);
  const spy = vi.spyOn(current.hub, "sendMessage");

  await withSocket(base, id, (ws) => {
    ws.send(JSON.stringify({ type: "user", text: "one", msgId: "a" }));
    ws.send(JSON.stringify({ type: "user", text: "two", msgId: "b" }));
  });

  const calls = spy.mock.calls.filter(([sid]) => sid === id);
  expect(calls).toHaveLength(2);
  spy.mockRestore();
});

test("no msgId → not deduped (two identical sends both forward, older-client behavior)", async () => {
  const config = configFor();
  current = createServer(config, managerFor());
  const base = await listen(current);
  const id = await createSession(current);
  const spy = vi.spyOn(current.hub, "sendMessage");

  await withSocket(base, id, (ws) => {
    ws.send(JSON.stringify({ type: "user", text: "hello" }));
    ws.send(JSON.stringify({ type: "user", text: "hello" }));
  });

  const calls = spy.mock.calls.filter(([sid]) => sid === id);
  expect(calls).toHaveLength(2);
  spy.mockRestore();
});
