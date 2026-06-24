import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { expect, test } from "vitest";
import { ClaudeProcess } from "../src/index.js";
import type { ResultEvent } from "@remote-coder/protocol";

const MOCK = fileURLToPath(new URL("./helpers/mock-claude-interactive.mjs", import.meta.url));

function makeProc(mode: string) {
  return new ClaudeProcess({
    claudeBin: process.execPath,
    cwd: process.cwd(),
    sessionId: "sid-interrupt",
    env: { ...process.env, MOCK_MODE: mode },
    startTimeoutMs: 5000,
  });
}

test("interrupt() writes an interrupt control_request on stdin and the aborted result settles", async () => {
  const proc = makeProc("simple");
  proc.setSpawnPrefixArgsForTest([MOCK]);
  await proc.start();

  // The aborted turn ends with a `result` whose terminal_reason is aborted_streaming. The CLI replies
  // with a control_response too, but the daemon's existing `result` handling is what settles state —
  // confirm THAT flows through (not surfaced as a scary error).
  const resultPromise: Promise<ResultEvent[]> = once(proc, "result") as Promise<ResultEvent[]>;
  let errored = false;
  proc.on("error", () => (errored = true));

  proc.interrupt();

  const [result] = await resultPromise;
  expect(result.type).toBe("result");
  expect(result.subtype).toBe("error_during_execution");
  expect(result.terminalReason).toBe("aborted_streaming");
  expect(errored).toBe(false);

  // The session stays open: a subsequent user message still drives a fresh turn.
  const nextResult: Promise<ResultEvent[]> = once(proc, "result") as Promise<ResultEvent[]>;
  proc.sendUserMessage("again");
  const [second] = await nextResult;
  expect(second.type).toBe("result");
  expect(second.terminalReason).toBeUndefined();

  proc.stop();
});

test("interrupt() emits the control_request as a real event on the wire", async () => {
  const proc = makeProc("simple");
  proc.setSpawnPrefixArgsForTest([MOCK]);
  await proc.start();

  // The CLI's success control_response to the interrupt arrives as a control_response event.
  const responsePromise = new Promise<void>((resolve) => {
    proc.on("event", (ev) => {
      if (ev.type === "control_response" && ev.subtype === "success") resolve();
    });
  });
  proc.interrupt();
  await responsePromise;
  proc.stop();
});
