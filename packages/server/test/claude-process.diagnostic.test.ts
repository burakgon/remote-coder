import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { expect, test } from "vitest";
import { ClaudeProcess } from "../src/index.js";
import type { DiagnosticEvent } from "../src/index.js";

const MOCK = fileURLToPath(new URL("./helpers/mock-claude-interactive.mjs", import.meta.url));

function makeProc(mode = "simple") {
  const proc = new ClaudeProcess({
    claudeBin: process.execPath,
    cwd: process.cwd(),
    sessionId: "sid-diag",
    env: { ...process.env, MOCK_MODE: mode },
    startTimeoutMs: 5000,
  });
  proc.setSpawnPrefixArgsForTest([MOCK]);
  return proc;
}

test("malformed stdout line emits a parser diagnostic, not a crash", async () => {
  const proc = makeProc();
  const diags: DiagnosticEvent[] = [];
  proc.on("diagnostic", (d) => diags.push(d));
  let errored = false;
  proc.on("error", () => (errored = true));
  await proc.start();

  proc.ingestLineForTest("{not valid json");

  expect(errored).toBe(false);
  expect(diags.some((d) => d.source === "parser")).toBe(true);
  proc.stop();
});

test("stderr from the child surfaces as a stderr diagnostic", async () => {
  const proc = makeProc("stderr"); // a mock mode that writes one stderr line
  const diagPromise: Promise<DiagnosticEvent[]> = once(proc, "diagnostic") as Promise<DiagnosticEvent[]>;
  await proc.start();
  const [diag] = await diagPromise;
  expect(diag.source).toBe("stderr");
  expect(diag.message).toContain("auth expired");
  proc.stop();
});
