import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, test } from "vitest";
import { SessionManager } from "../src/index.js";

const RECORDER = fileURLToPath(new URL("./helpers/argv-recorder-claude.mjs", import.meta.url));

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rc-attach-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function managerWithRecorder(): SessionManager {
  const argvPath = join(dir, "argv.json");
  const mgr = new SessionManager(
    { claudeBin: process.execPath },
    {
      spawnPrefixArgs: [RECORDER],
      baseEnv: { ...process.env, RECORD_ARGV_PATH: argvPath },
      startTimeoutMs: 5000,
    },
  );
  return mgr;
}

function readArgv(): string[] {
  return JSON.parse(readFileSync(join(dir, "argv.json"), "utf8"));
}

test("setAttachConfig makes a created session spawn claude with a well-formed --mcp-config", async () => {
  const mgr = managerWithRecorder();
  mgr.setAttachConfig({
    baseUrl: "http://127.0.0.1:5599",
    token: "tok-attach",
    mcpScriptPath: "/abs/dist/mcp-send.js",
  });
  const session = await mgr.createSession({ cwd: process.cwd() });
  const argv = readArgv();
  const i = argv.indexOf("--mcp-config");
  expect(i).toBeGreaterThanOrEqual(0);
  const cfg = JSON.parse(argv[i + 1]);
  expect(cfg.mcpServers["remote-coder"].args).toEqual(["/abs/dist/mcp-send.js"]);
  expect(cfg.mcpServers["remote-coder"].env).toEqual({
    RC_BASE_URL: "http://127.0.0.1:5599",
    RC_SESSION_ID: session.id,
    RC_TOKEN: "tok-attach",
  });
  mgr.stopSession(session.id);
});

test("without setAttachConfig a spawn carries NO --mcp-config (additive feature)", async () => {
  const mgr = managerWithRecorder();
  const session = await mgr.createSession({ cwd: process.cwd() });
  expect(readArgv()).not.toContain("--mcp-config");
  mgr.stopSession(session.id);
});
