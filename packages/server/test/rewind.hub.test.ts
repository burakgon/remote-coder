import { fileURLToPath } from "node:url";
import { expect, test, vi } from "vitest";
import { SessionManager, SessionHub, inMemoryFrameSpool } from "../src/index.js";
import type { FrameSpool, ServerFrame } from "../src/index.js";

const MOCK = fileURLToPath(new URL("./helpers/mock-claude-interactive.mjs", import.meta.url));

function hubFor(mode: string, spool?: FrameSpool) {
  const manager = new SessionManager(
    { claudeBin: process.execPath },
    { spawnPrefixArgs: [MOCK], baseEnv: { ...process.env, MOCK_MODE: mode }, startTimeoutMs: 5000 },
  );
  return { hub: new SessionHub(manager, spool ? { spool } : {}), manager };
}

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

test("rewind code: live rewind_files on the running process, success + a rewound frame", async () => {
  const { hub, manager } = hubFor("simple");
  const meta = await hub.createSession({ cwd: process.cwd() });
  const proc = manager.getSession(meta.id)!.process;
  const spy = vi.spyOn(proc, "rewindFiles");

  const rewoundPromise = waitForFrame(hub, meta.id, (f) => f.kind === "rewound");
  const result = await hub.rewind(meta.id, "uuid-cp", "code");

  expect(result.ok).toBe(true);
  expect(result.canRewind).toBe(true);
  expect(spy).toHaveBeenCalledWith("uuid-cp", {});

  const frame = await rewoundPromise;
  expect(frame.payload).toMatchObject({ checkpointId: "uuid-cp", mode: "code", ok: true });
  // code mode does NOT respawn the process.
  expect(manager.getSession(meta.id)).toBeDefined();

  hub.stopSession(meta.id);
});

test("rewind conversation: stops the live process and resumes it truncated at the checkpoint", async () => {
  const { hub, manager } = hubFor("simple");
  const meta = await hub.createSession({ cwd: process.cwd() });
  const resumeSpy = vi.spyOn(manager, "resumeSession");

  const rewoundPromise = waitForFrame(hub, meta.id, (f) => f.kind === "rewound");
  const result = await hub.rewind(meta.id, "uuid-cp", "conversation");

  expect(result.ok).toBe(true);
  // It resumed with --resume-session-at <uuid> but NOT --rewind-files (conversation-only).
  expect(resumeSpy).toHaveBeenCalledTimes(1);
  expect(resumeSpy.mock.calls[0]![1]).toMatchObject({ resumeSessionAt: "uuid-cp" });
  expect(resumeSpy.mock.calls[0]![1].rewindFilesAt).toBeUndefined();

  const frame = await rewoundPromise;
  expect(frame.payload).toMatchObject({ checkpointId: "uuid-cp", mode: "conversation", ok: true });
  // The session is live again (resumed) and not flagged errored.
  expect(hub.getSession(meta.id)?.status).toBe("running");

  hub.stopSession(meta.id);
});

test("rewind both: resumes with BOTH --resume-session-at and --rewind-files for the checkpoint", async () => {
  const { hub, manager } = hubFor("simple");
  const meta = await hub.createSession({ cwd: process.cwd() });
  const resumeSpy = vi.spyOn(manager, "resumeSession");

  const result = await hub.rewind(meta.id, "uuid-cp", "both");
  expect(result.ok).toBe(true);
  expect(resumeSpy.mock.calls[0]![1]).toMatchObject({ resumeSessionAt: "uuid-cp", rewindFilesAt: "uuid-cp" });

  hub.stopSession(meta.id);
});

test("rewind code on a disabled-checkpointing CLI resolves ok:false and still emits a rewound frame", async () => {
  const { hub } = hubFor("rewind-disabled");
  const meta = await hub.createSession({ cwd: process.cwd() });

  const rewoundPromise = waitForFrame(hub, meta.id, (f) => f.kind === "rewound");
  const result = await hub.rewind(meta.id, "uuid-cp", "code");
  expect(result.ok).toBe(false);
  expect(result.error).toBe("File rewinding is not enabled.");

  const frame = await rewoundPromise;
  expect(frame.payload).toMatchObject({ checkpointId: "uuid-cp", mode: "code", ok: false });

  hub.stopSession(meta.id);
});

test("rewind throws for an unknown session id (consistent with other hub ops)", async () => {
  const { hub } = hubFor("simple");
  await expect(hub.rewind("nope", "uuid", "code")).rejects.toThrow(/unknown session/);
});

// LOW-1: a conversation rewind DROPS every turn after the checkpoint, so the spool's post-checkpoint
// in-flight tail is now stale — it must be cleared so a reopen before the next result can't resurrect it.
test("rewind conversation CLEARS the spool (pre-rewind in-flight content can't resurrect on reopen)", async () => {
  const spool = inMemoryFrameSpool();
  const { hub } = hubFor("simple", spool);
  const meta = await hub.createSession({ cwd: process.cwd() });
  // Seed a spooled in-flight tail (a uuid-bearing assistant frame, the only spoolable event shape).
  spool.append(meta.id, {
    seq: 0,
    kind: "event",
    payload: { type: "assistant", uuid: "pre-rewind", message: { content: [{ type: "text", text: "stale tail" }] } },
  });
  expect(spool.read(meta.id).length).toBeGreaterThan(0);

  await hub.rewind(meta.id, "uuid-cp", "conversation");
  // The PRE-rewind in-flight tail is gone (cleared before the respawn) — it can't resurrect on reopen.
  // (The post-rewind `rewound` marker the handler emits legitimately re-spools; that's the new boundary.)
  const after = spool.read(meta.id);
  expect(after.some((f) => (f.payload as { uuid?: string }).uuid === "pre-rewind")).toBe(false);

  hub.stopSession(meta.id);
  spool.close();
});

// `code` rewind leaves the conversation intact, so its spool must NOT be cleared.
test("rewind code does NOT clear the spool (the conversation is unchanged)", async () => {
  const spool = inMemoryFrameSpool();
  const { hub } = hubFor("simple", spool);
  const meta = await hub.createSession({ cwd: process.cwd() });
  spool.append(meta.id, {
    seq: 0,
    kind: "event",
    payload: { type: "assistant", uuid: "keep", message: { content: [{ type: "text", text: "tail" }] } },
  });
  await hub.rewind(meta.id, "uuid-cp", "code");
  expect(spool.read(meta.id).length).toBeGreaterThan(0); // code rewind leaves the spool intact

  hub.stopSession(meta.id);
  spool.close();
});
