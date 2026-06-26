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

// "Skip" on an AskUserQuestion routes through answerPermission (the web client sends a `deny`
// permission). It must FULLY resolve the prompt: clean up the remembered tool_input AND emit a
// `resolve` frame (so a connected/reconnecting client clears the prompt). The `resolve` frame proves
// resolveFrame ran — which is exactly where the remembered tool_input is deleted. A subsequent answer
// for the same requestId is now a stale/duplicate and is dropped (no second control response).
test("a denied/skipped question is fully resolved (emits resolve; re-answer is a no-op)", async () => {
  const manager = new SessionManager(
    { claudeBin: process.execPath },
    { spawnPrefixArgs: [MOCK], baseEnv: { ...process.env, MOCK_MODE: "question" }, startTimeoutMs: 5000 },
  );
  const spy = vi.spyOn(manager, "answerQuestion");
  hub = new SessionHub(manager);
  const meta = await hub.createSession({ cwd: process.cwd() });

  let resolveSeen: string | undefined;
  const requestId = await new Promise<string>((resolve, reject) => {
    hub!.subscribe(meta.id, (frame: ServerFrame) => {
      if (frame.kind === "question") resolve((frame.payload as { requestId: string }).requestId);
      if (frame.kind === "resolve") resolveSeen = (frame.payload as { requestId: string }).requestId;
    });
    hub!.sendMessage(meta.id, "ask me");
    setTimeout(() => reject(new Error("no question frame")), 10000);
  });

  // Skip = deny. Resolves the prompt: a `resolve` frame fires (resolveFrame ran → tool_input cleaned).
  await hub.answerPermission(meta.id, requestId, "deny");
  expect(resolveSeen).toBe(requestId);

  // Re-answering the now-resolved requestId is a stale/duplicate → dropped (manager never called again).
  await hub.answerQuestion(meta.id, requestId, { fallback: "client-value" }, { "Which language?": "Python" });
  expect(spy).not.toHaveBeenCalled();
}, 20000);
