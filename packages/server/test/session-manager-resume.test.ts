import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { afterEach, expect, test } from "vitest";
import { SessionManager } from "../src/index.js";
import type { ResultEvent } from "@remote-coder/protocol";

const MOCK = fileURLToPath(new URL("./helpers/mock-claude-interactive.mjs", import.meta.url));

let manager: SessionManager | undefined;
afterEach(() => {
  for (const s of manager?.listSessions() ?? []) s.process.stop();
  manager = undefined;
});

test("resumeSession spawns a live process for an existing id and drives a turn", async () => {
  manager = new SessionManager(
    { claudeBin: process.execPath },
    { spawnPrefixArgs: [MOCK], baseEnv: { ...process.env, MOCK_MODE: "resume" }, startTimeoutMs: 5000 },
  );
  const session = await manager.resumeSession("known-id", { cwd: process.cwd() });
  expect(session.id).toBe("known-id");
  const r: Promise<ResultEvent[]> = once(session.process, "result") as Promise<ResultEvent[]>;
  manager.sendMessage("known-id", "hello again");
  const [result] = await r;
  expect(result.type).toBe("result");
});
