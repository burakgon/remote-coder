// packages/server/test/helpers/test-server.ts
// Thin wrapper around createServer for terminal-related transport tests.
import { EventEmitter } from "node:events";
import { SessionManager, createServer } from "../../src/index.js";
import { TerminalManager } from "../../src/terminal-manager.js";
import { openSessionStore } from "../../src/session-store.js";
import type { CreateServerResult, ServerRuntimeConfig } from "../../src/index.js";

const TOKEN = "test-token";

function configFor(): ServerRuntimeConfig {
  return {
    port: 0,
    bindAddress: "127.0.0.1",
    accessToken: TOKEN,
    fsRoot: process.cwd(),
    maxUploadBytes: 26214400,
    claude: { claudeBin: process.execPath },
  };
}

function fakePtySpawn() {
  const ee = new EventEmitter() as EventEmitter & {
    write(d: string): void;
    resize(c: number, r: number): void;
    kill(): void;
    onData(cb: (d: string) => void): void;
    onExit(cb: (e: { exitCode: number }) => void): void;
  };
  ee.write = () => {};
  ee.resize = () => {};
  ee.kill = () => {};
  ee.onData = (cb) => void ee.on("data", cb);
  ee.onExit = (cb) => void ee.on("exit", cb);
  return ee;
}

export interface TestServer extends CreateServerResult {
  token: string;
}

export async function buildTestServer(opts: { terminalAvailable: boolean }): Promise<TestServer> {
  const config = configFor();
  const store = openSessionStore({ dbPath: ":memory:" });
  const terminalManager = new TerminalManager({
    store,
    claudeBin: config.claude.claudeBin,
    now: () => Date.now(),
    ptySpawn: (() => fakePtySpawn()) as never,
    runTmux: () => {},
  });
  const manager = new SessionManager(config.claude, {});
  const result = createServer(config, manager, {
    store,
    terminalAvailable: opts.terminalAvailable,
    terminalManager,
  });
  return { ...result, token: TOKEN };
}
