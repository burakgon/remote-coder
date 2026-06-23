import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { SessionManager, SessionHub } from "../src/index.js";
import type { ServerFrame } from "../src/index.js";

const MOCK = fileURLToPath(new URL("./helpers/mock-claude-interactive.mjs", import.meta.url));

function hubFor(mode: string) {
  const manager = new SessionManager(
    { claudeBin: process.execPath },
    { spawnPrefixArgs: [MOCK], baseEnv: { ...process.env, MOCK_MODE: mode }, startTimeoutMs: 5000 },
  );
  return { hub: new SessionHub(manager), manager };
}

/** Resolve once a frame matching `pred` arrives on the subscription. */
function waitForFrame(
  hub: SessionHub,
  id: string,
  pred: (f: ServerFrame) => boolean,
): Promise<ServerFrame> {
  return new Promise((resolve) => {
    const sub = hub.subscribe(id, (f) => {
      if (pred(f)) {
        sub.unsubscribe();
        resolve(f);
      }
    });
  });
}

test("createSession records meta and a live subscriber receives a result frame", async () => {
  const { hub } = hubFor("simple");
  const meta = await hub.createSession({ cwd: process.cwd() });
  expect(meta.id).toMatch(/[0-9a-f]{8}-/i);
  expect(meta.status).toBe("running");
  expect(hub.listSessions()).toHaveLength(1);

  const resultFramePromise = waitForFrame(hub, meta.id, (f) => f.kind === "result");
  hub.sendMessage(meta.id, "hi");
  const frame = await resultFramePromise;
  expect(frame.kind).toBe("result");
  hub.stopSession(meta.id);
});

test("permission frames are delivered and answerable through the hub", async () => {
  const { hub } = hubFor("permission");
  const meta = await hub.createSession({ cwd: process.cwd() });

  const permPromise = waitForFrame(hub, meta.id, (f) => f.kind === "permission");
  hub.sendMessage(meta.id, "write a file");
  const permFrame = await permPromise;
  const requestId = (permFrame.payload as { requestId: string }).requestId;
  expect(typeof requestId).toBe("string");

  const resultPromise = waitForFrame(hub, meta.id, (f) => f.kind === "result");
  hub.answerPermission(meta.id, requestId, "allow", "ok");
  const resultFrame = await resultPromise;
  expect((resultFrame.payload as { permissionDenials?: unknown[] }).permissionDenials).toEqual([]);
  hub.stopSession(meta.id);
});

test("reconnect replay: a late subscriber receives buffered frames including the result", async () => {
  const { hub } = hubFor("simple");
  const meta = await hub.createSession({ cwd: process.cwd() });

  // Drive a full turn with a first subscriber, wait for its result.
  const firstResult = waitForFrame(hub, meta.id, (f) => f.kind === "result");
  hub.sendMessage(meta.id, "hi");
  await firstResult;

  // A brand-new subscriber (simulating reconnect) must immediately get the buffered frames.
  const replayed: ServerFrame[] = [];
  const sub = hub.subscribe(meta.id, (f) => replayed.push(f));
  sub.unsubscribe();
  expect(replayed.some((f) => f.kind === "result")).toBe(true);
  expect(replayed.length).toBeGreaterThan(0);

  // getHistory mirrors the buffer.
  expect(hub.getHistory(meta.id).some((f) => f.kind === "result")).toBe(true);
  hub.stopSession(meta.id);
});

test("unknown ids throw on hub operations", async () => {
  const { hub } = hubFor("simple");
  expect(() => hub.sendMessage("nope", "x")).toThrow();
  expect(() => hub.answerPermission("nope", "r", "allow")).toThrow();
  expect(() => hub.getHistory("nope")).toThrow();
  expect(() => hub.subscribe("nope", () => {})).toThrow();
});

test('an "error" emitted by a hub-managed process does not throw and becomes a diagnostic frame', async () => {
  // Node's EventEmitter throws on an "error" event with no listener attached, which
  // would crash the server. The hub MUST attach an "error" listener to every
  // ClaudeProcess it manages (folded into a diagnostic frame per the plan).
  const { hub, manager } = hubFor("simple");
  const meta = await hub.createSession({ cwd: process.cwd() });

  const frames: ServerFrame[] = [];
  const sub = hub.subscribe(meta.id, (f) => frames.push(f));

  const proc = manager.getSession(meta.id)!.process;
  // This is exactly what ClaudeProcess.write() does on a write-after-teardown.
  expect(() => proc.emit("error", new Error("write after teardown"))).not.toThrow();

  const diag = frames.find((f) => f.kind === "diagnostic");
  expect(diag).toBeDefined();
  expect((diag!.payload as { message: string }).message).toBe("write after teardown");
  expect(hub.getSession(meta.id)?.status).toBe("errored");

  sub.unsubscribe();
  hub.stopSession(meta.id);
});
