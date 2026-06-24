import { fileURLToPath } from "node:url";
import { mkdtemp, rm, writeFile, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { SessionManager, SessionHub, openSessionStore } from "../src/index.js";
import type { ServerFrame, SessionStore } from "../src/index.js";

const MOCK = fileURLToPath(new URL("./helpers/mock-claude-interactive.mjs", import.meta.url));

function managerFor(mode: string): SessionManager {
  return new SessionManager(
    { claudeBin: process.execPath },
    { spawnPrefixArgs: [MOCK], baseEnv: { ...process.env, MOCK_MODE: mode }, startTimeoutMs: 5000 },
  );
}

/** Resolve once a frame matching `pred` arrives on the subscription. */
function waitForFrame(hub: SessionHub, id: string, pred: (f: ServerFrame) => boolean): Promise<ServerFrame> {
  return new Promise((resolve) => {
    const sub = hub.subscribe(id, (f) => {
      if (pred(f)) {
        sub.unsubscribe();
        resolve(f);
      }
    });
  });
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "rc-lifecycle-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 1. Closing a session removes it from the list AND the store; transcript kept.
// ---------------------------------------------------------------------------

test("deleteSession removes the record + the store row and is idempotent on an unknown id", () => {
  const store = openSessionStore({ dbPath: ":memory:" });
  const hub = new SessionHub(managerFor("simple"), { store });

  // Seed a dormant session directly through the store, then load it into the hub.
  store.upsert({
    id: "sess-a",
    cwd: "/work/a",
    dangerouslySkip: false,
    status: "dormant",
    createdAt: 1,
    lastActivityAt: 1,
  });
  hub.loadFromStore();
  expect(hub.listSessions().map((s) => s.id)).toContain("sess-a");
  expect(store.get("sess-a")).toBeDefined();

  hub.deleteSession("sess-a");
  expect(hub.listSessions().map((s) => s.id)).not.toContain("sess-a");
  expect(store.get("sess-a")).toBeUndefined();

  // Idempotent: deleting an unknown id is a no-op (no throw).
  expect(() => hub.deleteSession("sess-a")).not.toThrow();
  expect(() => hub.deleteSession("never-existed")).not.toThrow();
  store.close();
});

test("a closed session does NOT reappear after the hub is reconstructed from the store", () => {
  const store: SessionStore = openSessionStore({ dbPath: join(dir, "s.db") });
  const hub1 = new SessionHub(managerFor("simple"), { store });
  store.upsert({
    id: "sess-b",
    cwd: "/work/b",
    dangerouslySkip: false,
    status: "dormant",
    createdAt: 1,
    lastActivityAt: 1,
  });
  hub1.loadFromStore();
  hub1.deleteSession("sess-b");
  store.close();

  // Reopen the SAME db file into a brand-new hub: the deleted row must be gone for good.
  const reopened = openSessionStore({ dbPath: join(dir, "s.db") });
  const hub2 = new SessionHub(managerFor("simple"), { store: reopened });
  hub2.loadFromStore();
  expect(hub2.listSessions().map((s) => s.id)).not.toContain("sess-b");
  reopened.close();
});

test("deleteSession stops a LIVE process but leaves the transcript .jsonl untouched", async () => {
  const store = openSessionStore({ dbPath: ":memory:" });
  const manager = managerFor("simple");
  const hub = new SessionHub(manager, { store });
  const meta = await hub.createSession({ cwd: process.cwd() });
  expect(manager.getSession(meta.id)).toBeDefined();

  // A stand-in transcript the daemon must NOT delete (claude owns it).
  const transcript = join(dir, `${meta.id}.jsonl`);
  await writeFile(transcript, '{"type":"user"}\n', "utf8");

  hub.deleteSession(meta.id);
  expect(manager.getSession(meta.id)).toBeUndefined(); // child stopped
  expect(hub.getSession(meta.id)).toBeUndefined(); // record removed
  expect(store.get(meta.id)).toBeUndefined(); // store row removed

  // Transcript untouched.
  await expect(stat(transcript)).resolves.toBeDefined();
  expect(await readFile(transcript, "utf8")).toBe('{"type":"user"}\n');
  store.close();
});

// ---------------------------------------------------------------------------
// 2. Exit status: clean -> dormant; crash / error -> errored.
// ---------------------------------------------------------------------------

test("a clean process exit (code 0) leaves the session DORMANT, not errored", async () => {
  const manager = managerFor("simple");
  const hub = new SessionHub(manager);
  const meta = await hub.createSession({ cwd: process.cwd() });
  const proc = manager.getSession(meta.id)!.process;

  proc.emit("exit", { code: 0, signal: null });
  expect(hub.getSession(meta.id)?.status).toBe("dormant");
  expect(hub.getSession(meta.id)?.awaiting).toBe(false);
});

test("a graceful kill signal (SIGTERM, e.g. host shutdown) is treated as a clean exit -> dormant", async () => {
  const manager = managerFor("simple");
  const hub = new SessionHub(manager);
  const meta = await hub.createSession({ cwd: process.cwd() });
  const proc = manager.getSession(meta.id)!.process;

  proc.emit("exit", { code: null, signal: "SIGTERM" });
  expect(hub.getSession(meta.id)?.status).toBe("dormant");
});

test("a non-zero exit code is a real failure -> errored", async () => {
  const manager = managerFor("simple");
  const hub = new SessionHub(manager);
  const meta = await hub.createSession({ cwd: process.cwd() });
  const proc = manager.getSession(meta.id)!.process;

  proc.emit("exit", { code: 1, signal: null });
  expect(hub.getSession(meta.id)?.status).toBe("errored");
});

test("a crash signal (SIGKILL) is a real failure -> errored", async () => {
  const manager = managerFor("simple");
  const hub = new SessionHub(manager);
  const meta = await hub.createSession({ cwd: process.cwd() });
  const proc = manager.getSession(meta.id)!.process;

  proc.emit("exit", { code: null, signal: "SIGKILL" });
  expect(hub.getSession(meta.id)?.status).toBe("errored");
});

test('an "error" event flags the session errored and a later clean exit does not un-error it', async () => {
  const manager = managerFor("simple");
  const hub = new SessionHub(manager);
  const meta = await hub.createSession({ cwd: process.cwd() });
  const proc = manager.getSession(meta.id)!.process;

  proc.emit("error", new Error("boom"));
  expect(hub.getSession(meta.id)?.status).toBe("errored");
  // A trailing clean exit must NOT downgrade a real error to dormant.
  proc.emit("exit", { code: 0, signal: null });
  expect(hub.getSession(meta.id)?.status).toBe("errored");
});

test("a deliberately stopped session is removed entirely, so its exit never flags errored", async () => {
  const manager = managerFor("simple");
  const hub = new SessionHub(manager);
  const meta = await hub.createSession({ cwd: process.cwd() });
  // deleteSession marks intentionalStop before killing; the eventual exit must not resurrect it as errored.
  hub.deleteSession(meta.id);
  expect(hub.getSession(meta.id)).toBeUndefined();
});

// ---------------------------------------------------------------------------
// 3. awaiting + lastActivityAt.
// ---------------------------------------------------------------------------

test("awaiting goes true on a pending permission and false when it is answered", async () => {
  const manager = managerFor("permission");
  const hub = new SessionHub(manager);
  const meta = await hub.createSession({ cwd: process.cwd() });
  expect(hub.getSession(meta.id)?.awaiting).toBe(false);

  const permPromise = waitForFrame(hub, meta.id, (f) => f.kind === "permission");
  await hub.sendMessage(meta.id, "write a file");
  const perm = await permPromise;
  const requestId = (perm.payload as { requestId: string }).requestId;
  expect(hub.getSession(meta.id)?.awaiting).toBe(true);

  const resultPromise = waitForFrame(hub, meta.id, (f) => f.kind === "result");
  await hub.answerPermission(meta.id, requestId, "allow", "ok");
  await resultPromise;
  expect(hub.getSession(meta.id)?.awaiting).toBe(false);
  hub.stopSession(meta.id);
});

test("awaiting clears on cancel/deny of a question (answerPermission deny path)", async () => {
  const manager = managerFor("question");
  const hub = new SessionHub(manager);
  const meta = await hub.createSession({ cwd: process.cwd() });

  const qPromise = waitForFrame(hub, meta.id, (f) => f.kind === "question");
  await hub.sendMessage(meta.id, "ask me");
  const q = await qPromise;
  const requestId = (q.payload as { requestId: string }).requestId;
  expect(hub.getSession(meta.id)?.awaiting).toBe(true);

  // The web "Skip" sends a deny permission for the question's requestId -> awaiting must clear.
  await hub.answerPermission(meta.id, requestId, "deny");
  expect(hub.getSession(meta.id)?.awaiting).toBe(false);
  hub.stopSession(meta.id);
});

test("lastActivityAt is present and monotonic across user-send and assistant activity", async () => {
  let clock = 1000;
  const manager = managerFor("simple");
  const hub = new SessionHub(manager, { now: () => clock });
  const meta = await hub.createSession({ cwd: process.cwd() });
  const t0 = hub.getSession(meta.id)!.lastActivityAt;
  expect(typeof t0).toBe("number");

  clock = 2000;
  const resultPromise = waitForFrame(hub, meta.id, (f) => f.kind === "result");
  await hub.sendMessage(meta.id, "hi");
  await resultPromise;
  const t1 = hub.getSession(meta.id)!.lastActivityAt;
  expect(t1).toBeGreaterThanOrEqual(t0);
  expect(t1).toBe(2000);
  hub.stopSession(meta.id);
});

test("a session rehydrated from the store is dormant + awaiting:false with the stored lastActivityAt", () => {
  const store = openSessionStore({ dbPath: ":memory:" });
  store.upsert({
    id: "sess-r",
    cwd: "/work/r",
    dangerouslySkip: false,
    status: "errored", // even if it was errored before, a fresh boot rehydrates as dormant
    createdAt: 5,
    lastActivityAt: 4242,
  });
  const hub = new SessionHub(managerFor("simple"), { store });
  hub.loadFromStore();
  const meta = hub.getSession("sess-r")!;
  expect(meta.status).toBe("dormant");
  expect(meta.awaiting).toBe(false);
  expect(meta.lastActivityAt).toBe(4242);
  store.close();
});
