import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { expect, test, vi } from "vitest";
import { ClaudeProcess } from "../src/index.js";
import type { ResultEvent } from "@remote-coder/protocol";

const MOCK = fileURLToPath(new URL("./helpers/mock-claude-interactive.mjs", import.meta.url));

function makeProc(mode: string) {
  return new ClaudeProcess({
    claudeBin: process.execPath,
    cwd: process.cwd(),
    sessionId: "sid-simple",
    // run the mock script as the "claude binary"
    env: { ...process.env, MOCK_MODE: mode },
    startTimeoutMs: 5000,
  });
}

// We must inject the mock script path as an arg. ClaudeProcess builds argv from buildClaudeArgs,
// so for the test we point claudeBin at node and pass the script via the `scriptArgs` test hook.
test("start() resolves after the init control_response", async () => {
  const proc = makeProc("simple");
  // prepend the mock script so `node <script> <claude args...>` runs the mock
  proc.setSpawnPrefixArgsForTest([MOCK]);
  await proc.start();
  expect(proc.sessionId).toBe("sid-simple");
  proc.stop();
});

test("a simple turn emits assistant + result, then the child exits", async () => {
  const proc = makeProc("simple");
  proc.setSpawnPrefixArgsForTest([MOCK]);
  const events: string[] = [];
  proc.on("event", (e) => events.push(e.type));
  const resultPromise: Promise<ResultEvent[]> = once(proc, "result") as Promise<ResultEvent[]>;
  const exitPromise = once(proc, "exit");

  await proc.start();
  proc.sendUserMessage("hi");

  const [result] = await resultPromise;
  expect(result.type).toBe("result");
  expect(result.permissionDenials).toEqual([]);

  await exitPromise; // closing stdin on result should let the mock exit
  expect(events).toContain("assistant");
  expect(events).toContain("result");
});

test("malformed stdout lines are skipped, not fatal", async () => {
  const proc = makeProc("simple");
  proc.setSpawnPrefixArgsForTest([MOCK]);
  let errored = false;
  proc.on("error", () => (errored = true));
  await proc.start();
  // The mock never emits malformed lines, but feeding the line buffer a junk line must not throw.
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  proc.ingestLineForTest("{not json");
  expect(warn).toHaveBeenCalled();
  expect(errored).toBe(false);
  warn.mockRestore();
  proc.stop();
});
