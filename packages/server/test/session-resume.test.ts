import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { expect, test } from "vitest";
import { ClaudeProcess } from "../src/index.js";
import type { InboundEvent, ResultEvent } from "@remote-coder/protocol";

const MOCK = fileURLToPath(new URL("./helpers/mock-claude-interactive.mjs", import.meta.url));

function makeProc(resume: boolean) {
  const proc = new ClaudeProcess({
    claudeBin: process.execPath,
    cwd: process.cwd(),
    sessionId: "sid-resume",
    resume,
    env: { ...process.env, MOCK_MODE: "resume" },
    startTimeoutMs: 5000,
  });
  proc.setSpawnPrefixArgsForTest([MOCK]);
  return proc;
}

test("a resumed process suppresses the synthetic warm-up turn", async () => {
  const proc = makeProc(true);
  const events: InboundEvent[] = [];
  proc.on("event", (ev) => events.push(ev));
  await proc.start();

  const resultPromise: Promise<ResultEvent[]> = once(proc, "result") as Promise<ResultEvent[]>;
  proc.sendUserMessage("real first message");
  await resultPromise;

  // The warm-up user/assistant pair must NOT have been emitted as events.
  const texts = events
    .filter((e) => e.type === "user" || e.type === "assistant")
    .map((e) => JSON.stringify((e as { message?: unknown }).message));
  expect(texts.some((t) => t.includes("Continue from where you left off."))).toBe(false);
  expect(texts.some((t) => t.includes("No response requested."))).toBe(false);

  const exitP = once(proc, "exit");
  proc.stop();
  await exitP;
});
