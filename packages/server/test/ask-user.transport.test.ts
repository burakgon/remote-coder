import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";
import { WebSocket } from "ws";
import { SessionManager, createServer } from "../src/index.js";
import type { ServerRuntimeConfig, CreateServerResult, ServerFrame } from "../src/index.js";

const MOCK = fileURLToPath(new URL("./helpers/mock-claude-interactive.mjs", import.meta.url));
const TOKEN = "ask-token";
const auth = { authorization: `Bearer ${TOKEN}` };

function makeServer(): CreateServerResult {
  const config: ServerRuntimeConfig = {
    port: 0,
    bindAddress: "127.0.0.1",
    accessToken: TOKEN,
    fsRoot: process.cwd(),
    maxUploadBytes: 26214400,
    claude: { claudeBin: process.execPath },
  };
  const manager = new SessionManager(config.claude, {
    spawnPrefixArgs: [MOCK],
    baseEnv: { ...process.env, MOCK_MODE: "simple" },
    startTimeoutMs: 5000,
  });
  return createServer(config, manager);
}

let current: CreateServerResult | undefined;
afterEach(async () => {
  if (current) await current.app.close();
  current = undefined;
});

async function createSession(result: CreateServerResult): Promise<string> {
  const created = await result.app.inject({ method: "POST", url: "/sessions", headers: auth, payload: { cwd: process.cwd() } });
  return created.json().session.id;
}

const QUESTIONS = [
  { question: "Which language?", header: "Language", options: [{ label: "TypeScript" }, { label: "Python" }] },
];
// What the frame carries after the route normalizes the body (multiSelect coerced to false).
const NORMALIZED = [{ ...QUESTIONS[0], multiSelect: false }];

test("POST /ask emits a question frame with an askId, holds, and resolves to { answers } on a matching WS answer", async () => {
  current = makeServer();
  const base = (await current.app.listen({ port: 0, host: "127.0.0.1" })).replace(/^http/, "ws");
  const id = await createSession(current);

  // Open a WS; when the question frame arrives, reply with an answer carrying its askId.
  const answered = new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`${base}/sessions/${id}/ws?token=${TOKEN}`);
    ws.on("message", (raw: Buffer) => {
      const frame: ServerFrame = JSON.parse(raw.toString());
      if (frame.kind === "question") {
        const p = frame.payload as { askId: string; requestId: string; questions: unknown };
        expect(p.askId).toMatch(/^ask-/);
        expect(p.requestId).toBe(p.askId); // mirrored so the existing web reducer renders it
        expect(p.questions).toEqual(NORMALIZED);
        ws.send(JSON.stringify({ type: "answer", askId: p.askId, answers: { "Which language?": "Python" } }));
        ws.close();
        resolve();
      }
    });
    ws.on("error", reject);
    setTimeout(() => reject(new Error("no question frame")), 8000);
  });

  // The POST blocks until the WS answer above resolves it.
  const res = await current.app.inject({ method: "POST", url: `/sessions/${id}/ask`, headers: auth, payload: { questions: QUESTIONS } });
  await answered;
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ answers: { "Which language?": "Python" } });
}, 20000);

test("POST /ask carries multi-select answers (incl. a custom Other entry) through to the response", async () => {
  current = makeServer();
  const base = (await current.app.listen({ port: 0, host: "127.0.0.1" })).replace(/^http/, "ws");
  const id = await createSession(current);
  const qs = [{ question: "Toppings", multiSelect: true, options: [{ label: "Cheese" }, { label: "Olives" }] }];

  new WebSocket(`${base}/sessions/${id}/ws?token=${TOKEN}`).on("message", function (this: WebSocket, raw: Buffer) {
    const frame: ServerFrame = JSON.parse(raw.toString());
    if (frame.kind === "question") {
      const p = frame.payload as { askId: string };
      this.send(JSON.stringify({ type: "answer", askId: p.askId, answers: { Toppings: ["Cheese", "Anchovy (custom)"] } }));
      this.close();
    }
  });

  const res = await current.app.inject({ method: "POST", url: `/sessions/${id}/ask`, headers: auth, payload: { questions: qs } });
  expect(res.json()).toEqual({ answers: { Toppings: ["Cheese", "Anchovy (custom)"] } });
}, 20000);

test("POST /ask 404s for an unknown session and 400s for a malformed body", async () => {
  current = makeServer();
  const id = await createSession(current);

  const unknown = await current.app.inject({ method: "POST", url: "/sessions/nope/ask", headers: auth, payload: { questions: QUESTIONS } });
  expect(unknown.statusCode).toBe(404);

  for (const bad of [{}, { questions: [] }, { questions: [{ question: "q" }] }, { questions: [{ question: "q", options: [] }] }, { questions: [{ question: "q", options: [{}] }] }]) {
    const res = await current.app.inject({ method: "POST", url: `/sessions/${id}/ask`, headers: auth, payload: bad });
    expect(res.statusCode).toBe(400);
  }
});

test("POST /ask requires a token (401 without one)", async () => {
  current = makeServer();
  const id = await createSession(current);
  const res = await current.app.inject({ method: "POST", url: `/sessions/${id}/ask`, payload: { questions: QUESTIONS } });
  expect(res.statusCode).toBe(401);
});

test("stopping the session while a POST /ask is held resolves it { cancelled: true } (no hang)", async () => {
  current = makeServer();
  const id = await createSession(current);

  const askP = current.app.inject({ method: "POST", url: `/sessions/${id}/ask`, headers: auth, payload: { questions: QUESTIONS } });
  // Give the route a tick to register the pending ask + emit the frame, then stop the session.
  await new Promise((r) => setTimeout(r, 100));
  await current.app.inject({ method: "POST", url: `/sessions/${id}/stop`, headers: auth });

  const res = await askP;
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ cancelled: true });
}, 20000);
