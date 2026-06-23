import { fileURLToPath } from "node:url";
import { afterEach, expect, test, vi } from "vitest";
import { SessionManager, SessionHub } from "../src/index.js";
import type { SessionStore, StoredSession } from "../src/index.js";

const MOCK = fileURLToPath(new URL("./helpers/mock-claude-interactive.mjs", import.meta.url));

let manager: SessionManager | undefined;
afterEach(() => {
  for (const s of manager?.listSessions() ?? []) s.process.stop();
  manager = undefined;
  vi.restoreAllMocks();
});

/** Minimal in-memory store so loadFromStore() can rehydrate a DORMANT session record. */
function storeWith(rows: StoredSession[]): SessionStore {
  const map = new Map(rows.map((r) => [r.id, { ...r }] as const));
  return {
    upsert: (s) => void map.set(s.id, { ...s }),
    get: (id) => {
      const v = map.get(id);
      return v ? { ...v } : undefined;
    },
    list: () => [...map.values()].map((v) => ({ ...v })),
    setStatus: (id, status) => {
      const v = map.get(id);
      if (v) v.status = status;
    },
    touch: (id, at) => {
      const v = map.get(id);
      if (v) v.lastActivityAt = at;
    },
    delete: (id) => void map.delete(id),
    close: () => map.clear(),
  };
}

function dormantHub(id: string, mode = "resume") {
  manager = new SessionManager(
    { claudeBin: process.execPath },
    { spawnPrefixArgs: [MOCK], baseEnv: { ...process.env, MOCK_MODE: mode }, startTimeoutMs: 5000 },
  );
  const store = storeWith([
    {
      id,
      cwd: process.cwd(),
      dangerouslySkip: false,
      status: "dormant",
      createdAt: 1,
      lastActivityAt: 1,
    },
  ]);
  const hub = new SessionHub(manager, { store });
  hub.loadFromStore();
  return { hub, manager: manager as SessionManager };
}

test("two overlapping ensureLive() calls resume a dormant session exactly ONCE (no double-spawn)", async () => {
  const id = "dormant-race";
  const { hub, manager } = dormantHub(id);
  expect(hub.getSession(id)?.status).toBe("dormant");

  const resumeSpy = vi.spyOn(manager, "resumeSession");

  // Fire BOTH before either resolves: the per-id in-flight lock must collapse the resume to one
  // spawn. ensureLive is private, so we drive it through two concurrent sendMessage calls (the
  // real fire-and-forget path from the WS handlers).
  await Promise.all([hub.sendMessage(id, "hi a"), hub.sendMessage(id, "hi b")]);

  // Exactly one resume/spawn happened...
  expect(resumeSpy).toHaveBeenCalledTimes(1);
  // ...and exactly one live process is registered (no orphan, no evicted live session).
  expect(manager.listSessions()).toHaveLength(1);
  expect(hub.getSession(id)?.status).toBe("running");
  expect(hub.subscriberCount(id)).toBe(0);
});

test("a FAILED resume releases the in-flight key so a later message retries", async () => {
  const id = "dormant-retry";
  const { hub, manager } = dormantHub(id);

  // First attempt: force resumeSession to reject so ensureLive's resume fails.
  const failingSpy = vi.spyOn(manager, "resumeSession").mockRejectedValueOnce(new Error("spawn boom"));
  await expect(hub.sendMessage(id, "first")).rejects.toThrow(/spawn boom/);
  expect(failingSpy).toHaveBeenCalledTimes(1);

  // The key must have been released: a subsequent message resumes for real (not awaiting a
  // settled-rejected promise) and succeeds.
  failingSpy.mockRestore();
  const resumeSpy = vi.spyOn(manager, "resumeSession");
  await hub.sendMessage(id, "second");
  expect(resumeSpy).toHaveBeenCalledTimes(1);
  expect(hub.getSession(id)?.status).toBe("running");
  expect(manager.listSessions()).toHaveLength(1);
});
