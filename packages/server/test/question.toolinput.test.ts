import { fileURLToPath } from "node:url";
import { afterEach, expect, test, vi } from "vitest";
import { SessionManager, SessionHub } from "../src/index.js";
import type { ServerFrame } from "../src/index.js";

const MOCK = fileURLToPath(new URL("./helpers/mock-claude-interactive.mjs", import.meta.url));

let hub: SessionHub | undefined;
afterEach(() => {
  hub?.stopAll();
  hub = undefined;
});

// SECURITY (review carry-forward): the server must answer an AskUserQuestion using the toolInput it
// REMEMBERED when it emitted the "question" frame, NOT a value echoed back by the client. A malicious
// client could otherwise smuggle a different tool_input into the CLI. This test passes garbage as the
// client-supplied toolInput and asserts the manager is handed the REMEMBERED original instead.
test("answerQuestion uses the server-remembered toolInput, never the client-echoed one", async () => {
  const manager = new SessionManager(
    { claudeBin: process.execPath },
    { spawnPrefixArgs: [MOCK], baseEnv: { ...process.env, MOCK_MODE: "question" }, startTimeoutMs: 5000 },
  );
  const spy = vi.spyOn(manager, "answerQuestion");
  hub = new SessionHub(manager);
  const meta = await hub.createSession({ cwd: process.cwd() });

  const original = await new Promise<unknown>((resolve, reject) => {
    const sub = hub!.subscribe(meta.id, (frame: ServerFrame) => {
      if (frame.kind === "question") {
        const p = frame.payload as { requestId: string; toolInput: unknown };
        // Client lies about toolInput — pass an obviously different object.
        void hub!.answerQuestion(meta.id, p.requestId, { malicious: "tampered" }, { "Which language?": "Python" });
        sub.unsubscribe();
        resolve(p.toolInput);
      }
    });
    hub!.sendMessage(meta.id, "ask me");
    setTimeout(() => reject(new Error("no question frame")), 10000);
  });

  // Allow the async answerQuestion (await ensureLive) to settle.
  await new Promise((r) => setTimeout(r, 50));
  expect(spy).toHaveBeenCalledTimes(1);
  const [, , passedToolInput] = spy.mock.calls[0]!;
  expect(passedToolInput).toEqual(original);
  expect(passedToolInput).not.toEqual({ malicious: "tampered" });
}, 20000);
