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

// LEAK FIX (review carry-forward): "Skip" on an AskUserQuestion routes through answerPermission
// (the web client sends a `deny` permission), which previously did NOT delete the remembered
// tool_input — so a skipped question leaked its entry for the session lifetime. answerPermission
// now mirrors answerQuestion's cleanup. We prove the entry is gone by answering the SAME requestId
// afterwards and asserting the hub falls back to the client-supplied tool_input (which only happens
// when nothing is remembered for that requestId).
test("a denied/skipped question's remembered tool_input is cleaned up", async () => {
  const manager = new SessionManager(
    { claudeBin: process.execPath },
    { spawnPrefixArgs: [MOCK], baseEnv: { ...process.env, MOCK_MODE: "question" }, startTimeoutMs: 5000 },
  );
  const spy = vi.spyOn(manager, "answerQuestion");
  hub = new SessionHub(manager);
  const meta = await hub.createSession({ cwd: process.cwd() });

  const requestId = await new Promise<string>((resolve, reject) => {
    const sub = hub!.subscribe(meta.id, (frame: ServerFrame) => {
      if (frame.kind === "question") {
        const p = frame.payload as { requestId: string };
        sub.unsubscribe();
        resolve(p.requestId);
      }
    });
    hub!.sendMessage(meta.id, "ask me");
    setTimeout(() => reject(new Error("no question frame")), 10000);
  });

  // Skip = deny via answerPermission. This must clean up the remembered tool_input.
  await hub.answerPermission(meta.id, requestId, "deny");

  // Now answer the same requestId. With the remembered entry gone, the hub falls back to the
  // client-supplied tool_input — which is the observable proof the leak was cleaned.
  const clientToolInput = { fallback: "client-value" };
  await hub.answerQuestion(meta.id, requestId, clientToolInput, { "Which language?": "Python" });

  expect(spy).toHaveBeenCalledTimes(1);
  const [, , passedToolInput] = spy.mock.calls[0]!;
  expect(passedToolInput).toEqual(clientToolInput);
}, 20000);
