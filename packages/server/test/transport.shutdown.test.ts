import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";
import { SessionManager, createServer } from "../src/index.js";
import type { ServerRuntimeConfig, CreateServerResult } from "../src/index.js";

const MOCK = fileURLToPath(new URL("./helpers/mock-claude-interactive.mjs", import.meta.url));
const TOKEN = "test-token";
const auth = { authorization: `Bearer ${TOKEN}` };

function makeServer(): { result: CreateServerResult; manager: SessionManager } {
  const config: ServerRuntimeConfig = {
    port: 0,
    bindAddress: "127.0.0.1",
    accessToken: TOKEN,
    fsRoot: process.cwd(),
    maxUploadBytes: 26214400,
    claude: { claudeBin: process.execPath },
  };
  const manager = new SessionManager(config.claude, {
    spawnPrefixArgs: [MOCK],
    baseEnv: { ...process.env, MOCK_MODE: "simple" },
    startTimeoutMs: 5000,
  });
  return { result: createServer(config, manager), manager };
}

let current: CreateServerResult | undefined;
afterEach(async () => {
  if (current) await current.app.close();
  current = undefined;
});

test("app.close() reaps live sessions (onClose -> hub.stopAll -> child stopped)", async () => {
  const { result, manager } = makeServer();
  current = result;
  const created = await result.app.inject({
    method: "POST",
    url: "/sessions",
    headers: auth,
    payload: { cwd: process.cwd() },
  });
  const id = created.json().session.id;
  // The child is live in the manager before shutdown.
  expect(manager.getSession(id)).toBeDefined();

  await result.app.close();
  current = undefined; // already closed; don't double-close in afterEach

  // onClose fired -> hub.stopAll() -> manager.stopSession() removed the session (child killed).
  expect(manager.getSession(id)).toBeUndefined();
  expect(result.hub.getSession(id)?.status).toBe("stopped");
});

test("hub.stopAll() stops every live session", async () => {
  const { result, manager } = makeServer();
  current = result;
  const a = (await result.app.inject({ method: "POST", url: "/sessions", headers: auth, payload: { cwd: process.cwd() } })).json().session.id;
  const b = (await result.app.inject({ method: "POST", url: "/sessions", headers: auth, payload: { cwd: process.cwd() } })).json().session.id;
  expect(manager.listSessions()).toHaveLength(2);

  result.hub.stopAll();

  expect(manager.getSession(a)).toBeUndefined();
  expect(manager.getSession(b)).toBeUndefined();
  expect(manager.listSessions()).toHaveLength(0);
  expect(result.hub.getSession(a)?.status).toBe("stopped");
  expect(result.hub.getSession(b)?.status).toBe("stopped");
});
