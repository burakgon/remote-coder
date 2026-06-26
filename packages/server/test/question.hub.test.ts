import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";
import { SessionManager, SessionHub } from "../src/index.js";
import type { ServerFrame } from "../src/index.js";

const MOCK = fileURLToPath(new URL("./helpers/mock-claude-interactive.mjs", import.meta.url));

let hub: SessionHub | undefined;
let manager: SessionManager | undefined;
afterEach(() => {
  hub?.stopAll();
  hub = undefined;
  manager = undefined;
});

test("hub surfaces a question frame and answerQuestion drives the result", async () => {
  manager = new SessionManager(
    { claudeBin: process.execPath },
    { spawnPrefixArgs: [MOCK], baseEnv: { ...process.env, MOCK_MODE: "question" }, startTimeoutMs: 5000 },
  );
  hub = new SessionHub(manager);
  const meta = await hub.createSession({ cwd: process.cwd() });

  await new Promise<void>((resolve, reject) => {
    hub!.subscribe(meta.id, (frame: ServerFrame) => {
      if (frame.kind === "question") {
        const p = frame.payload as { requestId: string; toolInput: unknown };
        hub!.answerQuestion(meta.id, p.requestId, p.toolInput, { "Which language?": "TypeScript" });
      }
      if (frame.kind === "result") {
        expect((frame.payload as { result?: string }).result).toContain("TypeScript");
        resolve();
      }
    });
    hub!.sendMessage(meta.id, "ask me");
    setTimeout(() => reject(new Error("question hub: no result")), 10000);
  });
}, 20000);

test("answering a question fans a `resolve` frame (clients clear the prompt now; reconnect won't re-show it)", async () => {
  manager = new SessionManager(
    { claudeBin: process.execPath },
    { spawnPrefixArgs: [MOCK], baseEnv: { ...process.env, MOCK_MODE: "question" }, startTimeoutMs: 5000 },
  );
  hub = new SessionHub(manager);
  const meta = await hub.createSession({ cwd: process.cwd() });

  await new Promise<void>((resolve, reject) => {
    let questionReqId: string | undefined;
    let sawResolve = false;
    hub!.subscribe(meta.id, (frame: ServerFrame) => {
      if (frame.kind === "question") {
        const p = frame.payload as { requestId: string; toolInput: unknown };
        questionReqId = p.requestId;
        hub!.answerQuestion(meta.id, p.requestId, p.toolInput, { "Which language?": "TypeScript" });
      }
      if (frame.kind === "resolve") {
        // The resolution fans out live AND its requestId matches the answered question.
        expect((frame.payload as { requestId?: string }).requestId).toBe(questionReqId);
        sawResolve = true;
      }
      if (frame.kind === "result") {
        expect(sawResolve).toBe(true);
        resolve();
      }
    });
    hub!.sendMessage(meta.id, "ask me");
    setTimeout(() => reject(new Error("question hub: no resolve frame before result")), 10000);
  });
}, 20000);
