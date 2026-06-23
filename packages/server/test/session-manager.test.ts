import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { expect, test } from "vitest";
import { SessionManager } from "../src/index.js";
import type { PermissionEvent } from "../src/index.js";
import type { ResultEvent } from "@remote-coder/protocol";

const MOCK = fileURLToPath(new URL("./helpers/mock-claude-interactive.mjs", import.meta.url));

function managerFor(mode: string) {
  return new SessionManager(
    { claudeBin: process.execPath },
    { spawnPrefixArgs: [MOCK], baseEnv: { ...process.env, MOCK_MODE: mode }, startTimeoutMs: 5000 },
  );
}

test("createSession spawns a started process with a generated UUID", async () => {
  const mgr = managerFor("simple");
  const session = await mgr.createSession({ cwd: process.cwd() });
  expect(session.id).toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
  expect(session.cwd).toBe(process.cwd());
  expect(mgr.getSession(session.id)).toBe(session);
  expect(mgr.listSessions()).toHaveLength(1);
  mgr.stopSession(session.id);
});

test("sendMessage drives a full turn to result", async () => {
  const mgr = managerFor("simple");
  const session = await mgr.createSession({ cwd: process.cwd() });
  const resultPromise: Promise<ResultEvent[]> = once(session.process, "result") as Promise<ResultEvent[]>;
  mgr.sendMessage(session.id, "hi");
  const [result] = await resultPromise;
  expect(result.type).toBe("result");
  mgr.stopSession(session.id);
});

test("two concurrent sessions are independent", async () => {
  const mgr = managerFor("simple");
  const a = await mgr.createSession({ cwd: process.cwd() });
  const b = await mgr.createSession({ cwd: process.cwd() });
  expect(a.id).not.toBe(b.id);
  expect(mgr.listSessions().map((s) => s.id).sort()).toEqual([a.id, b.id].sort());

  const ra: Promise<ResultEvent[]> = once(a.process, "result") as Promise<ResultEvent[]>;
  const rb: Promise<ResultEvent[]> = once(b.process, "result") as Promise<ResultEvent[]>;
  mgr.sendMessage(a.id, "hi a");
  mgr.sendMessage(b.id, "hi b");
  await Promise.all([ra, rb]);

  mgr.stopSession(a.id);
  mgr.stopSession(b.id);
});

test("answerPermission routes to the right session", async () => {
  const mgr = managerFor("permission");
  const session = await mgr.createSession({ cwd: process.cwd() });
  const permPromise: Promise<PermissionEvent[]> = once(session.process, "permission") as Promise<PermissionEvent[]>;
  const resultPromise: Promise<ResultEvent[]> = once(session.process, "result") as Promise<ResultEvent[]>;
  mgr.sendMessage(session.id, "write a file");
  const [perm] = await permPromise;
  mgr.answerPermission(session.id, perm.requestId, "allow", "ok");
  const [result] = await resultPromise;
  expect(result.permissionDenials).toEqual([]);
  mgr.stopSession(session.id);
});

test("stopSession removes the session; unknown ids throw", async () => {
  const mgr = managerFor("simple");
  const session = await mgr.createSession({ cwd: process.cwd() });
  mgr.stopSession(session.id);
  expect(mgr.getSession(session.id)).toBeUndefined();
  expect(mgr.listSessions()).toHaveLength(0);
  expect(() => mgr.sendMessage("nope", "x")).toThrow();
  expect(() => mgr.answerPermission("nope", "r", "allow")).toThrow();
});
