import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";
import { WebSocket } from "ws";
import { SessionManager, createServer } from "../src/index.js";
import type { ServerRuntimeConfig, CreateServerResult, ServerFrame } from "../src/index.js";

const MOCK = fileURLToPath(new URL("./helpers/mock-claude-interactive.mjs", import.meta.url));
const TOKEN = "q-token";

let current: CreateServerResult | undefined;
afterEach(async () => {
  if (current) await current.app.close();
  current = undefined;
});

// Cross-task driver: the inbound `answer` client frame is recognized by transport.ts's
// handleClientFrame, which is wired in Task 11. Un-skipped in Task 11 once `answer` is wired.
test("AskUserQuestion: question frame -> answer frame -> model reflects the choice", async () => {
  const config: ServerRuntimeConfig = {
    port: 0, bindAddress: "127.0.0.1", accessToken: TOKEN,
    fsRoot: process.cwd(), maxUploadBytes: 26214400, claude: { claudeBin: process.execPath },
  };
  const manager = new SessionManager(config.claude, {
    spawnPrefixArgs: [MOCK], baseEnv: { ...process.env, MOCK_MODE: "question" }, startTimeoutMs: 5000,
  });
  current = createServer(config, manager);
  const httpUrl = await current.app.listen({ port: 0, host: "127.0.0.1" });
  const wsBase = httpUrl.replace(/^http/, "ws");

  const created = await current.app.inject({
    method: "POST", url: "/sessions",
    headers: { authorization: `Bearer ${TOKEN}` }, payload: { cwd: process.cwd() },
  });
  const id = created.json().session.id;

  await new Promise<void>((resolve, reject) => {
    let sent = false;
    const ws = new WebSocket(`${wsBase}/sessions/${id}/ws?token=${TOKEN}`);
    ws.on("message", (raw: Buffer) => {
      const frame: ServerFrame = JSON.parse(raw.toString());
      if (!sent) {
        sent = true;
        ws.send(JSON.stringify({ type: "user", content: "ask me" }));
      }
      if (frame.kind === "question") {
        const p = frame.payload as { requestId: string; toolInput: unknown };
        ws.send(JSON.stringify({ type: "answer", requestId: p.requestId, toolInput: p.toolInput, answers: { "Which language?": "Python" } }));
      }
      if (frame.kind === "result") {
        expect((frame.payload as { result?: string }).result).toContain("Python");
        ws.close();
        resolve();
      }
    });
    ws.on("error", reject);
    setTimeout(() => reject(new Error("question e2e: no result")), 10000);
  });
}, 20000);
