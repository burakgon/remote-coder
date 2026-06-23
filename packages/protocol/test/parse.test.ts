import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { parseLine, ProtocolParseError, type InboundEvent } from "../src/index.js";

function loadFixture(name: string): InboundEvent[] {
  const path = fileURLToPath(new URL(`../fixtures/${name}.jsonl`, import.meta.url));
  return readFileSync(path, "utf8")
    .split("\n")
    .map((l) => parseLine(l))
    .filter((e): e is InboundEvent => e !== null);
}
// CLI-emitted lines only (drop the fixture's outbound `_dir:"out"` lines).
function inbound(events: InboundEvent[]): InboundEvent[] {
  return events.filter((e) => (e.raw as { _dir?: string })._dir !== "out");
}

test("blank lines return null", () => {
  expect(parseLine("")).toBeNull();
  expect(parseLine("   ")).toBeNull();
});

test("invalid JSON throws ProtocolParseError", () => {
  expect(() => parseLine("{nope")).toThrow(ProtocolParseError);
});

test("parses system/init with session and model", () => {
  const line = JSON.stringify({
    type: "system",
    subtype: "init",
    session_id: "s1",
    model: "claude-opus-4-8[1m]",
    tools: ["Bash"],
    cwd: "/w",
  });
  expect(parseLine(line)).toMatchObject({
    type: "system",
    subtype: "init",
    sessionId: "s1",
    model: "claude-opus-4-8[1m]",
    cwd: "/w",
  });
});

test("parses a hook_callback control_request: requestId top-level, subtype from request", () => {
  const line = JSON.stringify({
    type: "control_request",
    request_id: "r1",
    request: { subtype: "hook_callback", callback_id: "hook_0", input: { tool_name: "Write" } },
  });
  expect(parseLine(line)).toMatchObject({ type: "control_request", requestId: "r1", subtype: "hook_callback" });
});

test("parses a control_response: requestId + subtype nested under response", () => {
  const line = JSON.stringify({
    type: "control_response",
    response: { subtype: "success", request_id: "r1", response: { ok: true } },
  });
  expect(parseLine(line)).toMatchObject({ type: "control_response", requestId: "r1", subtype: "success" });
});

test("unknown type becomes UnknownEvent and keeps raw", () => {
  const ev = parseLine(JSON.stringify({ type: "brand_new", x: 1 }));
  expect(ev?.type).toBe("unknown");
  expect((ev as { raw: { x: number } }).raw.x).toBe(1);
});

test("golden: simple-turn parses; has system/init and a result; no permission request", () => {
  const cli = inbound(loadFixture("simple-turn"));
  expect(cli.some((e) => e.type === "system" && (e as { subtype: string }).subtype === "init")).toBe(true);
  expect(cli.some((e) => e.type === "result")).toBe(true);
  expect(cli.some((e) => e.type === "control_request")).toBe(false);
});

test("golden: permission-turn has a hook_callback control_request and a result", () => {
  const cli = inbound(loadFixture("permission-turn"));
  expect(cli.some((e) => e.type === "control_request" && (e as { subtype: string }).subtype === "hook_callback")).toBe(
    true,
  );
  expect(cli.some((e) => e.type === "result")).toBe(true);
});
