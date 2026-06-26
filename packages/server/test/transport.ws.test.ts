import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";
import { WebSocket } from "ws";
import { SessionManager, createServer } from "../src/index.js";
import type { ServerRuntimeConfig, CreateServerResult, ServerFrame } from "../src/index.js";

const MOCK = fileURLToPath(new URL("./helpers/mock-claude-interactive.mjs", import.meta.url));
const TOKEN = "test-token";

function configFor(): ServerRuntimeConfig {
  return {
    port: 0,
    bindAddress: "127.0.0.1",
    accessToken: TOKEN,
    fsRoot: process.cwd(),
    maxUploadBytes: 26214400,
    claude: { claudeBin: process.execPath },
  };
}

function managerFor(mode: string, config: ServerRuntimeConfig) {
  return new SessionManager(config.claude, {
    spawnPrefixArgs: [MOCK],
    baseEnv: { ...process.env, MOCK_MODE: mode },
    startTimeoutMs: 5000,
  });
}

let current: CreateServerResult | undefined;
afterEach(async () => {
  if (current) await current.app.close();
  current = undefined;
});

/** Start listening on an ephemeral port; return the base ws:// URL. */
async function listen(result: CreateServerResult): Promise<string> {
  const address = await result.app.listen({ port: 0, host: "127.0.0.1" });
  // address is like "http://127.0.0.1:54321"
  return address.replace(/^http/, "ws");
}

/** Open a ws to a session, collecting frames; drive + finish callbacks like the mock test. */
function openWs(
  base: string,
  id: string,
  token: string | undefined,
  onFrame: (frame: ServerFrame, ws: WebSocket) => void,
): WebSocket {
  const q = token ? `?token=${encodeURIComponent(token)}` : "";
  const ws = new WebSocket(`${base}/sessions/${id}/ws${q}`);
  ws.on("message", (data: Buffer) => onFrame(JSON.parse(data.toString()), ws));
  return ws;
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

/** A handshake that never opens / receives a frame is the security acceptance check. */
async function expectUpgradeRejected(url: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(url);
    let gotFrame = false;
    ws.on("message", () => (gotFrame = true));
    ws.on("open", () => {
      // An open without auth would be a security bug. Fail fast.
      ws.close();
      reject(new Error("ws upgrade unexpectedly succeeded without a valid token"));
    });
    const settle = () => {
      expect(gotFrame).toBe(false);
      resolve();
    };
    ws.on("error", settle); // a 401 upgrade surfaces here as "Unexpected server response: 401"
    ws.on("close", settle); // some platforms emit close (code 1006) instead/also
    setTimeout(() => reject(new Error("ws neither errored nor closed after a rejected upgrade")), 4000);
  });
}

test("WS handshake without a valid token fails the upgrade (never opens / receives a frame)", async () => {
  const config = configFor();
  current = createServer(config, managerFor("simple", config));
  const base = await listen(current);
  const id = await createSession(current);

  // A wrong token is rejected by the global preHandler during the HTTP upgrade (401),
  // so the `ws` client either errors or closes WITHOUT ever opening or receiving a frame.
  await expectUpgradeRejected(`${base}/sessions/${id}/ws?token=wrong`);
  // A missing token is rejected the same way (the security check Task 8's review deferred here).
  await expectUpgradeRejected(`${base}/sessions/${id}/ws`);
});

test("WS handshake WITH the correct token (via ?token=) succeeds and replays/streams a frame", async () => {
  const config = configFor();
  current = createServer(config, managerFor("simple", config));
  const base = await listen(current);
  const id = await createSession(current);

  // The accept side of the security check: the same upgrade that is rejected above
  // succeeds when ?token= carries the configured token, and the socket can receive a frame.
  await new Promise<void>((resolve, reject) => {
    const ws = openWs(base, id, TOKEN, (_frame, sock) => {
      sock.close();
      resolve();
    });
    ws.on("open", () => {
      // Drive a turn so there is at least one frame to receive.
      ws.send(JSON.stringify({ type: "user", content: "hi" }));
    });
    ws.on("error", reject);
    setTimeout(() => reject(new Error("authed ws never opened or received a frame")), 6000);
  });
});

test("WS: send a user message, receive streamed frames + a result", async () => {
  const config = configFor();
  current = createServer(config, managerFor("simple", config));
  const base = await listen(current);
  const id = await createSession(current);

  await new Promise<void>((resolve, reject) => {
    let sent = false;
    const kinds: string[] = [];
    const ws = openWs(base, id, TOKEN, (frame, sock) => {
      kinds.push(frame.kind);
      if (!sent) {
        sent = true;
        sock.send(JSON.stringify({ type: "user", content: "hi" }));
      }
      if (frame.kind === "result") {
        expect(kinds).toContain("event");
        sock.close();
        resolve();
      }
    });
    ws.on("error", reject);
    setTimeout(() => reject(new Error("no result over ws")), 6000);
  });
});

test("WS: malformed user blocks are rejected, never forwarded to claude (no result)", async () => {
  const config = configFor();
  current = createServer(config, managerFor("simple", config));
  const base = await listen(current);
  const id = await createSession(current);

  // Garbage blocks must not reach serializeUserMessage -> claude stdin. With nothing
  // valid to forward, no turn is driven and no `result` frame ever arrives. (A subscriber
  // may still see the session's buffered init `event` on connect — that is legitimate
  // replay, not a response to the malformed input; only a `result` proves a turn ran.)
  await new Promise<void>((resolve, reject) => {
    let sawResult = false;
    const ws = openWs(base, id, TOKEN, (frame) => {
      if (frame.kind === "result") sawResult = true;
    });
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "user", blocks: [{ type: "bogus", evil: true }, 42, "nope"] }));
      ws.send(JSON.stringify({ type: "user" })); // no text/blocks/images at all
    });
    ws.on("error", reject);
    // Give the server time to (not) respond, then assert no turn was driven.
    setTimeout(() => {
      expect(sawResult).toBe(false);
      ws.close();
      resolve();
    }, 1500);
  });
});

test("WS: a subscriber is removed on socket close (no leak in the hub)", async () => {
  const config = configFor();
  current = createServer(config, managerFor("simple", config));
  const hub = current.hub;
  const base = await listen(current);
  const id = await createSession(current);

  await new Promise<void>((resolve, reject) => {
    const ws = openWs(base, id, TOKEN, () => {});
    ws.on("open", () => {
      // One subscriber while open.
      expect(hub.subscriberCount(id)).toBe(1);
      ws.close();
    });
    ws.on("close", () => {
      // The hub callback's "close" handler must unsubscribe. Allow the event loop a tick.
      setTimeout(() => {
        try {
          expect(hub.subscriberCount(id)).toBe(0);
          resolve();
        } catch (err) {
          reject(err as Error);
        }
      }, 100);
    });
    ws.on("error", reject);
    setTimeout(() => reject(new Error("ws never opened/closed")), 6000);
  });
});

test("WS: ?since=N delta replay sends only frames with seq > N", async () => {
  const config = configFor();
  current = createServer(config, managerFor("simple", config));
  const base = await listen(current);
  const id = await createSession(current);
  const hub = current.hub;

  // Drive a full turn so the buffer holds several frames (init event + stream events + result).
  await new Promise<void>((resolve, reject) => {
    let sent = false;
    const ws = openWs(base, id, TOKEN, (frame, sock) => {
      if (!sent) {
        sent = true;
        sock.send(JSON.stringify({ type: "user", content: "hi" }));
      }
      if (frame.kind === "result") {
        sock.close();
        resolve();
      }
    });
    ws.on("error", reject);
    setTimeout(() => reject(new Error("no result over ws (since setup)")), 6000);
  });

  // Pick a cutoff in the middle of the buffer; reconnect with ?since=cutoff. getHistory now returns
  // { history, sinceSeq }; with no HistoryService wired, history mirrors the (retained) buffer.
  const all = (await hub.getHistory(id)).history;
  expect(all.length).toBeGreaterThan(1);
  const cutoff = all[Math.floor(all.length / 2)]!.seq;

  await new Promise<void>((resolve, reject) => {
    const q = `?token=${encodeURIComponent(TOKEN)}&since=${cutoff}`;
    const ws = new WebSocket(`${base}/sessions/${id}/ws${q}`);
    const seqs: number[] = [];
    ws.on("message", (data: Buffer) => seqs.push((JSON.parse(data.toString()) as ServerFrame).seq));
    ws.on("error", reject);
    ws.on("open", () => {
      // The replay is synchronous on subscribe; give the event loop a tick to flush, then assert.
      setTimeout(() => {
        try {
          expect(seqs.length).toBeGreaterThan(0); // some frames ARE after the cutoff
          expect(seqs.every((s) => s > cutoff)).toBe(true); // and NONE at or before it
          ws.close();
          resolve();
        } catch (err) {
          ws.close();
          reject(err as Error);
        }
      }, 200);
    });
    setTimeout(() => reject(new Error("since-replay socket never opened")), 6000);
  });
});

test("WS: permission round-trip and reconnect replay", async () => {
  const config = configFor();
  current = createServer(config, managerFor("permission", config));
  const base = await listen(current);
  const id = await createSession(current);

  // First connection: drive to a permission, answer allow, get the result.
  await new Promise<void>((resolve, reject) => {
    let sent = false;
    let answered = false;
    const ws = openWs(base, id, TOKEN, (frame, sock) => {
      if (!sent) {
        sent = true;
        sock.send(JSON.stringify({ type: "user", content: "write a file" }));
      }
      if (frame.kind === "permission" && !answered) {
        answered = true;
        const requestId = (frame.payload as { requestId: string }).requestId;
        sock.send(JSON.stringify({ type: "permission", requestId, decision: "allow", reason: "ok" }));
      }
      if (frame.kind === "result") {
        sock.close();
        resolve();
      }
    });
    ws.on("error", reject);
    setTimeout(() => reject(new Error("no result over ws (permission)")), 8000);
  });

  // Reconnect: a fresh socket must immediately replay the buffered frames incl. the result.
  await new Promise<void>((resolve, reject) => {
    const replayed: string[] = [];
    const ws = openWs(base, id, TOKEN, (frame, sock) => {
      replayed.push(frame.kind);
      if (frame.kind === "result") {
        // The permission was ANSWERED before the reconnect, so it's pruned from the replay buffer (a
        // reconnecting client must NOT re-show an already-answered prompt). The result still replays.
        expect(replayed).not.toContain("permission");
        expect(replayed).toContain("result");
        sock.close();
        resolve();
      }
    });
    ws.on("error", reject);
    setTimeout(() => reject(new Error("reconnect did not replay the result")), 4000);
  });
});
