import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import {
  parseLine,
  serializeInitialize,
  serializeUserMessage,
  serializeHookPermissionResponse,
  type InboundEvent,
} from "@remote-coder/protocol";

const MOCK = fileURLToPath(new URL("./helpers/mock-claude-interactive.mjs", import.meta.url));

/** Spawn the mock, collect parsed stdout events; on each event run `drive`, finish when `done`. */
function runMock(
  mode: string,
  drive: (write: (line: string) => void, events: InboundEvent[]) => void,
  done: (events: InboundEvent[]) => boolean,
): Promise<InboundEvent[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [MOCK], {
      env: { ...process.env, MOCK_MODE: mode },
      stdio: ["pipe", "pipe", "inherit"],
    });
    const events: InboundEvent[] = [];
    let buffer = "";
    let settled = false;
    const write = (line: string) => child.stdin.write(line + "\n");
    const finish = () => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve(events);
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        const ev = parseLine(line);
        if (!ev) continue;
        events.push(ev);
        drive(write, events);
        if (done(events)) finish();
      }
    });
    child.on("error", reject);
    child.on("exit", finish);
    // kick off the handshake
    write(serializeInitialize({ requestId: "init-test" }));
  });
}

test("mock (simple): initialize -> control_response + init, then user -> result", async () => {
  let sentUser = false;
  const events = await runMock(
    "simple",
    (write, evs) => {
      // After init lands, send a user message exactly once.
      if (!sentUser && evs.some((e) => e.type === "system" && (e as { subtype: string }).subtype === "init")) {
        sentUser = true;
        write(serializeUserMessage("hi"));
      }
    },
    (evs) => evs.some((e) => e.type === "result"),
  );

  expect(
    events.some((e) => e.type === "control_response" && (e as { requestId?: string }).requestId === "init-test"),
  ).toBe(true);
  expect(events.some((e) => e.type === "system" && (e as { subtype: string }).subtype === "init")).toBe(true);
  expect(events.some((e) => e.type === "stream_event")).toBe(true);
  expect(events.some((e) => e.type === "assistant")).toBe(true);
  expect(events.some((e) => e.type === "result")).toBe(true);
});

test("mock (permission): user -> hook_callback, allow -> tool_result + result with empty denials", async () => {
  let sentUser = false;
  let answered = false;
  const events = await runMock(
    "permission",
    (write, evs) => {
      if (!sentUser && evs.some((e) => e.type === "system" && (e as { subtype: string }).subtype === "init")) {
        sentUser = true;
        write(serializeUserMessage("write a file"));
      }
      if (!answered) {
        const req = evs.find(
          (e) => e.type === "control_request" && (e as { subtype: string }).subtype === "hook_callback",
        );
        if (req) {
          answered = true;
          write(serializeHookPermissionResponse((req as { requestId: string }).requestId, "allow", "ok"));
        }
      }
    },
    (evs) => evs.some((e) => e.type === "result"),
  );

  expect(
    events.some((e) => e.type === "control_request" && (e as { subtype: string }).subtype === "hook_callback"),
  ).toBe(true);
  expect(events.some((e) => e.type === "user")).toBe(true);
  const result = events.find((e) => e.type === "result");
  expect(result).toBeTruthy();
  expect((result as { permissionDenials?: unknown[] }).permissionDenials).toEqual([]);
});
