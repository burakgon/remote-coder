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

test("WS: a client `interrupt` frame reaches the process and yields an aborted result", async () => {
  const config = configFor();
  current = createServer(config, managerFor("simple", config));
  const base = await listen(current);
  const id = await createSession(current);

  await new Promise<void>((resolve, reject) => {
    let sentInterrupt = false;
    const q = `?token=${encodeURIComponent(TOKEN)}`;
    const ws = new WebSocket(`${base}/sessions/${id}/ws${q}`);
    ws.on("message", (data: Buffer) => {
      const frame = JSON.parse(data.toString()) as ServerFrame;
      // Once connected (we get the buffered init event), send a STOP.
      if (!sentInterrupt) {
        sentInterrupt = true;
        ws.send(JSON.stringify({ type: "interrupt" }));
      }
      if (frame.kind === "result") {
        const payload = frame.payload as { subtype?: string; terminalReason?: string };
        try {
          expect(payload.subtype).toBe("error_during_execution");
          expect(payload.terminalReason).toBe("aborted_streaming");
        } catch (err) {
          ws.close();
          reject(err as Error);
          return;
        }
        ws.close();
        resolve();
      }
    });
    ws.on("open", () => {
      // Kick a turn first so there's something to interrupt, then the message handler interrupts.
      ws.send(JSON.stringify({ type: "user", content: "do a long thing" }));
    });
    ws.on("error", reject);
    setTimeout(() => reject(new Error("no aborted result over ws")), 8000);
  });
});

test("WS: an interrupt for an unknown frame shape / no live turn does not crash the server", async () => {
  const config = configFor();
  current = createServer(config, managerFor("simple", config));
  const base = await listen(current);
  const id = await createSession(current);

  await new Promise<void>((resolve, reject) => {
    const q = `?token=${encodeURIComponent(TOKEN)}`;
    const ws = new WebSocket(`${base}/sessions/${id}/ws${q}`);
    ws.on("open", () => {
      // Interrupt with no in-flight turn — must be a safe no-op (the mock still acks + emits a result).
      ws.send(JSON.stringify({ type: "interrupt" }));
      // Give the server a beat to (not) crash; a follow-up user turn must still work.
      setTimeout(() => ws.send(JSON.stringify({ type: "user", content: "still alive?" })), 200);
    });
    let sawNormalResult = false;
    ws.on("message", (data: Buffer) => {
      const frame = JSON.parse(data.toString()) as ServerFrame;
      if (frame.kind === "result") {
        const payload = frame.payload as { terminalReason?: string };
        // The final (post user-message) result is a normal turn — proving the server survived.
        if (payload.terminalReason === undefined) sawNormalResult = true;
        if (sawNormalResult) {
          ws.close();
          resolve();
        }
      }
    });
    ws.on("error", reject);
    setTimeout(() => reject(new Error("server did not survive an interrupt with no live turn")), 8000);
  });
});
