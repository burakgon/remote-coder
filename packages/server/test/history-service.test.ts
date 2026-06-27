import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { HistoryService } from "../src/index.js";
import { encodeProjectDir } from "@remote-coder/protocol";

let claudeHome: string;
beforeEach(async () => {
  claudeHome = await mkdtemp(join(tmpdir(), "rc-home-"));
});
afterEach(async () => {
  await rm(claudeHome, { recursive: true, force: true });
});

test("read() resolves the jsonl from cwd+id and returns parsed turns", async () => {
  const cwd = "/work/proj";
  const dir = join(claudeHome, ".claude", "projects", encodeProjectDir(cwd));
  await mkdir(dir, { recursive: true });
  const lines = [
    JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: "q" }] } }),
    JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "a" }] } }),
  ].join("\n");
  await writeFile(join(dir, "sid-1.jsonl"), lines);

  const svc = new HistoryService({ claudeHome });
  const turns = await svc.read(cwd, "sid-1");
  expect(turns.map((t) => t.type)).toEqual(["user", "assistant"]);
});

test("read() returns [] when the transcript file is missing (no throw)", async () => {
  const svc = new HistoryService({ claudeHome });
  expect(await svc.read("/nope", "missing")).toEqual([]);
});

test("the default claudeHome is the OS home dir", () => {
  const svc = new HistoryService();
  expect(svc.claudeHome).toBe(homedir());
});

test("resolveTranscriptPath/read FALL BACK to a scan when encodeProjectDir misses (no data loss)", async () => {
  // Simulate the lossy-encoding miss: the transcript lives under a project dir that does NOT equal
  // encodeProjectDir(cwd) (e.g. Claude's truncation+hash branch for a very long cwd). The encoded path
  // won't find it, but the scan must — otherwise a resumable session is wrongly treated as dead.
  const cwd = "/some/very/long/path/that/encodes/differently";
  const wrongDir = join(claudeHome, ".claude", "projects", "claude-actual-encoded-dir-abc123");
  await mkdir(wrongDir, { recursive: true });
  const lines = JSON.stringify({
    type: "user",
    message: { role: "user", content: [{ type: "text", text: "hi" }] },
  });
  await writeFile(join(wrongDir, "sid-scan.jsonl"), lines);

  const svc = new HistoryService({ claudeHome });
  expect(svc.transcriptPath(cwd, "sid-scan")).not.toBe(join(wrongDir, "sid-scan.jsonl"));
  expect(svc.resolveTranscriptPath(cwd, "sid-scan")).toBe(join(wrongDir, "sid-scan.jsonl"));
  expect((await svc.read(cwd, "sid-scan")).map((t) => t.type)).toEqual(["user"]);
});

test("resolveTranscriptPath ignores an empty transcript file (size 0 → undefined)", async () => {
  const cwd = "/work/empty";
  const dir = join(claudeHome, ".claude", "projects", encodeProjectDir(cwd));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "sid-empty.jsonl"), "");
  const svc = new HistoryService({ claudeHome });
  expect(svc.resolveTranscriptPath(cwd, "sid-empty")).toBeUndefined();
});

test("readSubagents restores subagent transcripts tagged with the spawning toolUseId, depth-ordered", async () => {
  const cwd = "/work/sa";
  const dir = join(claudeHome, ".claude", "projects", encodeProjectDir(cwd));
  const subDir = join(dir, "sid-sa", "subagents");
  await mkdir(subDir, { recursive: true });
  await writeFile(
    join(dir, "sid-sa.jsonl"),
    JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: "go" }] } }),
  );
  // depth-2 nested agent written FIRST on disk to prove depth sorting reorders it last.
  await writeFile(join(subDir, "agent-bbb.meta.json"), JSON.stringify({ toolUseId: "toolu_child", spawnDepth: 2 }));
  await writeFile(
    join(subDir, "agent-bbb.jsonl"),
    JSON.stringify({
      type: "assistant",
      isSidechain: true,
      agentId: "bbb",
      message: { role: "assistant", content: [{ type: "text", text: "inner" }] },
    }),
  );
  await writeFile(join(subDir, "agent-aaa.meta.json"), JSON.stringify({ toolUseId: "toolu_parent", spawnDepth: 1 }));
  // The parent's turn SPAWNS the child (an Agent tool_use with id=toolu_child) → anchors the child transitively.
  await writeFile(
    join(subDir, "agent-aaa.jsonl"),
    JSON.stringify({
      type: "assistant",
      isSidechain: true,
      agentId: "aaa",
      message: { role: "assistant", content: [{ type: "tool_use", name: "Task", id: "toolu_child", input: {} }] },
    }),
  );

  const svc = new HistoryService({ claudeHome });
  // Only toolu_parent is anchored by the main window; the child is anchored transitively via the parent.
  const turns = svc.readSubagents(cwd, "sid-sa", new Set(["toolu_parent"]));
  // depth-1 (parent) before depth-2 (nested); each tagged with its meta toolUseId — NOT the on-disk agentId.
  expect(turns.map((t) => t.parentToolUseId)).toEqual(["toolu_parent", "toolu_child"]);
});

test("readSubagents SKIPS a subagent whose spawn is not anchored in the window (no orphan stuck-running)", async () => {
  const cwd = "/work/orphan";
  const dir = join(claudeHome, ".claude", "projects", encodeProjectDir(cwd));
  const subDir = join(dir, "sid-orphan", "subagents");
  await mkdir(subDir, { recursive: true });
  await writeFile(
    join(dir, "sid-orphan.jsonl"),
    JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: "go" }] } }),
  );
  await writeFile(join(subDir, "agent-old.meta.json"), JSON.stringify({ toolUseId: "toolu_old", spawnDepth: 1 }));
  await writeFile(
    join(subDir, "agent-old.jsonl"),
    JSON.stringify({
      type: "assistant",
      isSidechain: true,
      agentId: "old",
      message: { role: "assistant", content: [{ type: "text", text: "old subagent" }] },
    }),
  );

  const svc = new HistoryService({ claudeHome });
  // The spawning Agent tool_use scrolled out of the window → not anchored → not restored (no stuck thread).
  expect(svc.readSubagents(cwd, "sid-orphan", new Set())).toEqual([]);
  // But when anchored, it IS restored.
  expect(svc.readSubagents(cwd, "sid-orphan", new Set(["toolu_old"])).map((t) => t.parentToolUseId)).toEqual([
    "toolu_old",
  ]);
});

test("readSubagents returns [] when the session has no subagents dir", () => {
  const svc = new HistoryService({ claudeHome });
  expect(svc.readSubagents("/nope", "missing", new Set())).toEqual([]);
});
