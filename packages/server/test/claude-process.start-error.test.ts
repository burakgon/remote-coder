import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { ClaudeProcess, ClaudeStartError, looksLikeAuthError } from "../src/index.js";

const MOCK = fileURLToPath(new URL("./helpers/mock-claude-interactive.mjs", import.meta.url));

function makeProc(opts: { bin?: string; mode?: string; prefixMock?: boolean }) {
  const proc = new ClaudeProcess({
    claudeBin: opts.bin ?? process.execPath,
    cwd: process.cwd(),
    sessionId: "sid-start-err",
    env: { ...process.env, MOCK_MODE: opts.mode ?? "simple" },
    startTimeoutMs: 4000,
  });
  if (opts.prefixMock ?? true) proc.setSpawnPrefixArgsForTest([MOCK]);
  return proc;
}

test("a missing binary (ENOENT) rejects start() with a typed CLAUDE_NOT_FOUND error", async () => {
  // No mock prefix + a bogus bin name → spawn ENOENTs.
  const proc = makeProc({ bin: "definitely-not-a-real-binary-xyz", prefixMock: false });
  await expect(proc.start()).rejects.toMatchObject({ code: "CLAUDE_NOT_FOUND" });
  proc.stop();
});

test("a non-Error spawn failure still produces a ClaudeStartError instance", async () => {
  const proc = makeProc({ bin: "definitely-not-a-real-binary-xyz", prefixMock: false });
  await proc.start().catch((err) => {
    expect(err).toBeInstanceOf(ClaudeStartError);
    expect((err as ClaudeStartError).code).toBe("CLAUDE_NOT_FOUND");
  });
});

test("claude that exits before the handshake rejects with CLAUDE_START_FAILED", async () => {
  const proc = makeProc({ mode: "exit-before-init" });
  await expect(proc.start()).rejects.toMatchObject({ code: "CLAUDE_START_FAILED" });
});

test("an auth-looking stderr is captured as the start-failure detail", async () => {
  const proc = makeProc({ mode: "auth-fail" });
  const err = await proc.start().catch((e) => e as ClaudeStartError);
  expect(err).toBeInstanceOf(ClaudeStartError);
  expect(err.code).toBe("CLAUDE_START_FAILED");
  // The captured stderr tail carries the host's own auth message so the transport can detect it.
  expect(err.detail).toBeTruthy();
  expect(looksLikeAuthError(err.detail ?? "")).toBe(true);
});

test("the init timeout rejects with CLAUDE_START_FAILED (spawned but never initialized)", async () => {
  // "hang" never answers the initialize handshake; a tiny timeout makes the wait reject quickly.
  const proc = new ClaudeProcess({
    claudeBin: process.execPath,
    cwd: process.cwd(),
    sessionId: "sid-timeout",
    env: { ...process.env, MOCK_MODE: "hang" },
    startTimeoutMs: 150,
  });
  proc.setSpawnPrefixArgsForTest([MOCK]);
  await expect(proc.start()).rejects.toMatchObject({ code: "CLAUDE_START_FAILED" });
  proc.stop();
});

test("looksLikeAuthError matches login/credential wording, not generic noise", () => {
  expect(looksLikeAuthError("Please run `claude login`")).toBe(true);
  expect(looksLikeAuthError("Invalid API key")).toBe(true);
  expect(looksLikeAuthError("Your session has expired")).toBe(true);
  expect(looksLikeAuthError("Unauthorized")).toBe(true);
  expect(looksLikeAuthError("wrote 3 files to disk")).toBe(false);
});
