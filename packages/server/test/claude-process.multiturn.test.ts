import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { expect, test } from "vitest";
import { ClaudeProcess } from "../src/index.js";
import type { ResultEvent } from "@remote-coder/protocol";

const MOCK = fileURLToPath(new URL("./helpers/mock-claude-interactive.mjs", import.meta.url));

function makeProc() {
  const proc = new ClaudeProcess({
    claudeBin: process.execPath,
    cwd: process.cwd(),
    sessionId: "sid-multiturn",
    env: { ...process.env, MOCK_MODE: "simple" },
    startTimeoutMs: 5000,
  });
  proc.setSpawnPrefixArgsForTest([MOCK]);
  return proc;
}

test("two turns run on ONE keep-alive process (no exit between turns)", async () => {
  const proc = makeProc();
  let exited = false;
  proc.on("exit", () => (exited = true));
  await proc.start();

  // Turn 1.
  const r1: Promise<ResultEvent[]> = once(proc, "result") as Promise<ResultEvent[]>;
  proc.sendUserMessage("first");
  const [result1] = await r1;
  expect(result1.type).toBe("result");
  expect(exited).toBe(false); // the process must NOT exit after turn 1

  // Turn 2 on the SAME process — proves stdin stayed open.
  const r2: Promise<ResultEvent[]> = once(proc, "result") as Promise<ResultEvent[]>;
  proc.sendUserMessage("second");
  const [result2] = await r2;
  expect(result2.type).toBe("result");
  expect(exited).toBe(false);

  // Teardown closes stdin -> the mock exits cleanly.
  const exitPromise = once(proc, "exit");
  proc.stop();
  await exitPromise;
});

test("write after stop() does not crash; it surfaces a clear error", async () => {
  const proc = makeProc();
  await proc.start();
  const exitPromise = once(proc, "exit");
  proc.stop();
  await exitPromise;

  let err: Error | undefined;
  proc.on("error", (e) => (err = e));
  // Must not throw synchronously, and must not crash the process.
  expect(() => proc.sendUserMessage("too late")).not.toThrow();
  expect(err).toBeInstanceOf(Error);
  expect(err?.message).toContain("write after teardown");
});
