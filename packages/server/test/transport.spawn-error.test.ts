import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { SessionManager, createServer, mapSpawnError } from "../src/index.js";
import { ClaudeStartError } from "../src/index.js";
import type { ServerRuntimeConfig, CreateServerResult } from "../src/index.js";

const MOCK = fileURLToPath(new URL("./helpers/mock-claude-interactive.mjs", import.meta.url));
const TOKEN = "test-token";
const auth = { authorization: `Bearer ${TOKEN}` };

function configFor(claudeBin = process.execPath): ServerRuntimeConfig {
  return {
    port: 0,
    bindAddress: "127.0.0.1",
    accessToken: TOKEN,
    fsRoot: process.cwd(),
    maxUploadBytes: 26214400,
    claude: { claudeBin },
  };
}

/** A manager that drives the mock in `mode` (so start() really fails the way that mode models). */
function managerFor(mode: string, config: ServerRuntimeConfig) {
  return new SessionManager(config.claude, {
    spawnPrefixArgs: [MOCK],
    baseEnv: { ...process.env, MOCK_MODE: mode },
    startTimeoutMs: 4000,
  });
}

let current: CreateServerResult | undefined;
afterEach(async () => {
  if (current) await current.app.close();
  current = undefined;
});

// --- mapSpawnError (pure) --------------------------------------------------

describe("mapSpawnError", () => {
  test("CLAUDE_NOT_FOUND → 503 with a PATH/install hint", () => {
    const { status, body } = mapSpawnError(new ClaudeStartError("CLAUDE_NOT_FOUND", "spawn claude ENOENT"));
    expect(status).toBe(503);
    expect(body.code).toBe("CLAUDE_NOT_FOUND");
    expect(body.hint).toMatch(/not found on PATH/i);
  });

  test("CLAUDE_START_FAILED with auth-looking detail → 502 with an explicit not-authenticated hint", () => {
    const { status, body } = mapSpawnError(
      new ClaudeStartError("CLAUDE_START_FAILED", "claude exited before completing the initialize handshake", {
        detail: "Please run `claude login` to authenticate",
      }),
    );
    expect(status).toBe(502);
    expect(body.code).toBe("CLAUDE_START_FAILED");
    expect(body.hint).toMatch(/not authenticated/i);
    expect(body.hint).toMatch(/Run `claude` once/i);
    expect(body.detail).toContain("authenticate");
  });

  test("CLAUDE_START_FAILED with no auth detail → 502, still advises logging in", () => {
    const { status, body } = mapSpawnError(
      new ClaudeStartError("CLAUDE_START_FAILED", "claude did not respond to initialize within 30000ms"),
    );
    expect(status).toBe(502);
    expect(body.hint).toMatch(/Run `claude` once/i);
    expect(body.detail).toBeUndefined();
  });

  test("an unexpected error → a generic 500 (no invented hint, but points at logs/diag)", () => {
    const { status, body } = mapSpawnError(new Error("kaboom"));
    expect(status).toBe(500);
    expect(body.code).toBeUndefined();
    expect(body.error).toBe("kaboom");
    expect(body.hint).toMatch(/diag/i);
  });
});

// --- POST /sessions end-to-end mapping -------------------------------------

test("POST /sessions → 503 when the claude binary isn't found (ENOENT)", async () => {
  const config = configFor("definitely-not-a-real-binary-xyz");
  // No mock prefix → the bogus bin actually ENOENTs at spawn.
  const manager = new SessionManager(config.claude, { startTimeoutMs: 4000 });
  current = createServer(config, manager);
  const res = await current.app.inject({
    method: "POST",
    url: "/sessions",
    headers: auth,
    payload: { cwd: process.cwd() },
  });
  expect(res.statusCode).toBe(503);
  expect(res.json().hint).toMatch(/not found on PATH/i);
});

test("POST /sessions → 502 when claude exits before the handshake", async () => {
  const config = configFor();
  current = createServer(config, managerFor("exit-before-init", config));
  const res = await current.app.inject({
    method: "POST",
    url: "/sessions",
    headers: auth,
    payload: { cwd: process.cwd() },
  });
  expect(res.statusCode).toBe(502);
  expect(res.json().code).toBe("CLAUDE_START_FAILED");
  expect(res.json().hint).toMatch(/Run `claude` once/i);
});

test("POST /sessions → 502 with a not-authenticated hint when stderr looks like an auth error", async () => {
  const config = configFor();
  current = createServer(config, managerFor("auth-fail", config));
  const res = await current.app.inject({
    method: "POST",
    url: "/sessions",
    headers: auth,
    payload: { cwd: process.cwd() },
  });
  expect(res.statusCode).toBe(502);
  expect(res.json().hint).toMatch(/not authenticated/i);
});

test("a successful spawn is unaffected (still 201)", async () => {
  const config = configFor();
  current = createServer(config, managerFor("simple", config));
  const res = await current.app.inject({
    method: "POST",
    url: "/sessions",
    headers: auth,
    payload: { cwd: process.cwd() },
  });
  expect(res.statusCode).toBe(201);
});
