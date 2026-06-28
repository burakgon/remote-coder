import { expect, test } from "vitest";
import { encodeProjectDir, parseTranscript } from "../src/index.js";

test("encodeProjectDir maps every non-alphanumeric char to a dash (lossy)", () => {
  expect(encodeProjectDir("/private/tmp/rc-spike5")).toBe("-private-tmp-rc-spike5");
  expect(encodeProjectDir("/Users/u/Developer/remote-coder")).toBe("-Users-u-Developer-remote-coder");
  expect(encodeProjectDir("/a/magicplay.io")).toBe("-a-magicplay-io"); // the dot collapses to a dash
});

test("encodeProjectDir does NOT truncate/hash very long cwds (documented Plan-6 limitation)", () => {
  // Claude's real encoder truncates an over-long encoded name and appends a base36 hash; this
  // implementation does NOT. We pin that documented behavior: a long cwd produces the plain,
  // full-length dash substitution (one-to-one length, no `-<hash>` suffix). For such a deep path
  // the computed projects/<dir> may diverge from Claude's, so history can read empty (see the
  // function doc-comment + docs/protocol-notes.md).
  const deep = "/Users/somebody/" + "really-long-segment/".repeat(20) + "project";
  const encoded = encodeProjectDir(deep);
  // Pure substitution: same length, only [A-Za-z0-9] and '-' survive, nothing truncated/hashed.
  expect(encoded.length).toBe(deep.length);
  expect(encoded).toMatch(/^[A-Za-z0-9-]+$/);
  expect(encoded).toBe(deep.replace(/[^a-zA-Z0-9]/g, "-"));
});

test("parseTranscript keeps user/assistant turns in file order and drops bookkeeping", () => {
  const lines = [
    JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: "hi" }] },
      uuid: "u1",
      parentUuid: null,
    }),
    JSON.stringify({ type: "queue-operation", foo: 1 }),
    JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "hello" }] },
      uuid: "a1",
      parentUuid: "u1",
    }),
    JSON.stringify({ type: "attachment" }),
    "", // blank line tolerated
    "{ not json", // malformed line tolerated (skipped)
  ].join("\n");
  const turns = parseTranscript(lines);
  expect(turns.map((t) => t.type)).toEqual(["user", "assistant"]);
  expect(turns[0]?.uuid).toBe("u1");
  expect(turns[1]?.parentUuid).toBe("u1");
});

test("parseTranscript carries isMeta so replayed history can skip injected (skill) user lines", () => {
  const lines = [
    JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: "skill content" }] },
      uuid: "m1",
      isMeta: true,
    }),
    JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: "typed" }] }, uuid: "u1" }),
  ].join("\n");
  const turns = parseTranscript(lines);
  expect(turns).toHaveLength(2);
  expect(turns[0]?.isMeta).toBe(true); // injected line flagged → client renders it as meta, not "YOU"
  expect(turns[1]?.isMeta).toBeUndefined(); // a normal typed line is not meta
});

test("parseTranscript carries isCompactSummary so a reopened compaction renders a marker, not a giant 'YOU' bubble", () => {
  const lines = [
    // The post-compaction seed: flagged isCompactSummary (and isVisibleInTranscriptOnly) but NOT isMeta,
    // so without carrying the flag it falls through to a giant raw "YOU" bubble on reopen.
    JSON.stringify({
      type: "user",
      message: { role: "user", content: "This session is being continued from a previous conversation…" },
      uuid: "cs1",
      isCompactSummary: true,
      isVisibleInTranscriptOnly: true,
    }),
    JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: "typed" }] }, uuid: "u1" }),
  ].join("\n");
  const turns = parseTranscript(lines);
  expect(turns).toHaveLength(2);
  expect(turns[0]?.isCompactSummary).toBe(true); // the compaction seed → a clean marker on reopen
  expect(turns[1]?.isCompactSummary).toBeUndefined(); // a normal typed line is not a compaction summary
});

test("parseTranscript folds a harness-injected origin (task-notification) into isMeta — not a 'YOU' turn", () => {
  const lines = [
    // A background task-notification: injected by the harness as a plain user line. It carries NO
    // `isMeta` but an `origin.kind`; a human line has no `origin`.
    JSON.stringify({
      type: "user",
      message: { role: "user", content: "<task-notification><task-id>x</task-id></task-notification>" },
      uuid: "tn1",
      origin: { kind: "task-notification" },
    }),
    JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: "typed" }] }, uuid: "u1" }),
  ].join("\n");
  const turns = parseTranscript(lines);
  expect(turns).toHaveLength(2);
  expect(turns[0]?.isMeta).toBe(true); // origin-tagged injection → meta, never a "YOU" bubble on reopen
  expect(turns[1]?.isMeta).toBeUndefined(); // a human message has no origin → stays a real "YOU" turn
});

test("parseTranscript carries parent_tool_use_id (subagent linkage) with a sidechain fallback", () => {
  const lines = [
    // A subagent's own line with an explicit parent_tool_use_id (the Agent tool_use id).
    JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "sub work" }] },
      uuid: "s1",
      parent_tool_use_id: "ag1",
    }),
    // A sidechain line MISSING parent_tool_use_id → falls back to its agentId (so it still routes off main).
    JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: "sidechain" }] },
      uuid: "s2",
      isSidechain: true,
      agentId: "agent-xyz",
    }),
    // A normal main line → no parent linkage.
    JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: "main" }] }, uuid: "m1" }),
  ].join("\n");
  const turns = parseTranscript(lines);
  expect(turns[0]?.parentToolUseId).toBe("ag1");
  expect(turns[1]?.parentToolUseId).toBe("agent-xyz"); // sidechain fallback → never leaks into main
  expect(turns[2]?.parentToolUseId).toBeUndefined();
});

// --- ACTIVE-BRANCH RECONSTRUCTION (append-only rewind tree) -----------------------------------------

test("parseTranscript: a LINEAR transcript (A→B→C) is returned unchanged (identity invariant)", () => {
  // The normal case: every parentUuid chains the previous line. Output MUST be byte-for-byte the same as
  // before branch-following existed (this is what keeps live==reopen parity + all existing tests green).
  const lines = [
    JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: "A" }] },
      uuid: "A",
      parentUuid: null,
    }),
    JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "B" }] },
      uuid: "B",
      parentUuid: "A",
    }),
    JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: "C" }] },
      uuid: "C",
      parentUuid: "B",
    }),
  ].join("\n");
  const turns = parseTranscript(lines);
  expect(turns.map((t) => t.uuid)).toEqual(["A", "B", "C"]);
});

test("parseTranscript: a FORKED transcript drops the rewound-away branch and renders the active path in order", () => {
  // A→B→C is the original conversation. A rewind to B forks: a new turn D's parentUuid is B (skipping C),
  // then E follows D. C is the rewound-away (dead) branch and MUST be excluded; the active path is A,B,D,E.
  const lines = [
    JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: "A" }] },
      uuid: "A",
      parentUuid: null,
    }),
    JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "B" }] },
      uuid: "B",
      parentUuid: "A",
    }),
    JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: "C-dead" }] },
      uuid: "C",
      parentUuid: "B",
    }),
    JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: "D" }] },
      uuid: "D",
      parentUuid: "B",
    }),
    JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "E" }] },
      uuid: "E",
      parentUuid: "D",
    }),
  ].join("\n");
  const turns = parseTranscript(lines);
  expect(turns.map((t) => t.uuid)).toEqual(["A", "B", "D", "E"]); // C dropped, file order preserved
});

test("parseTranscript: a fork is followed THROUGH intermediate (non-user/assistant) lines (real claude shape)", () => {
  // Real claude chains an assistant line's parentUuid through an INTERMEDIATE bookkeeping line (a
  // file-history-snapshot / system entry), NOT directly to the previous main line. The active-branch walk
  // must traverse those intermediates — walking main-only would stop at the leaf and prune NOTHING (the
  // live-verified bug). Shape: A(user) → x1(intermediate) → B(assistant) → {C-dead(user)…} fork
  // {D(user) → x3(intermediate) → E(assistant)}. The dead branch (C and its reply) MUST be dropped.
  const lines = [
    JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: "A" }] },
      uuid: "A",
      parentUuid: null,
    }),
    JSON.stringify({ type: "file-history-snapshot", uuid: "x1", parentUuid: "A" }), // intermediate (no type user/assistant)
    JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "B" }] },
      uuid: "B",
      parentUuid: "x1",
    }),
    JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: "C-dead" }] },
      uuid: "C",
      parentUuid: "B",
    }),
    JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "Cr-dead" }] },
      uuid: "Cr",
      parentUuid: "C",
    }),
    JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: "D" }] },
      uuid: "D",
      parentUuid: "B",
    }), // fork at B
    JSON.stringify({ type: "system", uuid: "x3", parentUuid: "D" }), // intermediate
    JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "E" }] },
      uuid: "E",
      parentUuid: "x3",
    }),
  ].join("\n");
  const turns = parseTranscript(lines);
  expect(turns.map((t) => t.uuid)).toEqual(["A", "B", "D", "E"]); // C + Cr (dead branch) dropped
});

test("parseTranscript: a fork KEEPS a sidechain anchored to a kept line but DROPS one anchored off-branch", () => {
  // A→B is shared. C (dead) carried an Agent tool_use `tu-dead` with a subagent line; D (active) carried
  // `tu-live` with its own subagent line. After pruning C, the off-branch subagent must go too, while the
  // active subagent stays so subagent restore isn't broken.
  const lines = [
    JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: "A" }] },
      uuid: "A",
      parentUuid: null,
    }),
    JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "B" }] },
      uuid: "B",
      parentUuid: "A",
    }),
    JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "tool_use", id: "tu-dead", name: "Agent", input: {} }] },
      uuid: "C",
      parentUuid: "B",
    }),
    JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "dead-sub" }] },
      uuid: "Cs",
      parentUuid: "C",
      isSidechain: true,
      parent_tool_use_id: "tu-dead",
    }),
    JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "tool_use", id: "tu-live", name: "Agent", input: {} }] },
      uuid: "D",
      parentUuid: "B",
    }),
    JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "live-sub" }] },
      uuid: "Ds",
      parentUuid: "D",
      isSidechain: true,
      parent_tool_use_id: "tu-live",
    }),
  ].join("\n");
  const turns = parseTranscript(lines);
  expect(turns.map((t) => t.uuid)).toEqual(["A", "B", "D", "Ds"]); // C + its off-branch subagent dropped
});

test("parseTranscript: parentUuid-less (old format) transcript is NOT pruned even with a later non-chaining line", () => {
  // Every line lacks parentUuid (pre-tree format). Two distinct user lines exist, but neither forks off a
  // shared path → no genuine fork → keep everything (the safety fallback that preserves old-format reads).
  const lines = [
    JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: "one" }] }, uuid: "u1" }),
    JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "r1" }] },
      uuid: "a1",
    }),
    JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: "two" }] }, uuid: "u2" }),
  ].join("\n");
  const turns = parseTranscript(lines);
  expect(turns.map((t) => t.uuid)).toEqual(["u1", "a1", "u2"]);
});

test("parseTranscript drops the synthetic --resume warm-up pair", () => {
  const lines = [
    JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: "Continue from where you left off." }] },
    }),
    JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "No response requested." }] },
    }),
    JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: "real" }] } }),
  ].join("\n");
  const turns = parseTranscript(lines);
  expect(turns).toHaveLength(1);
  expect(turns[0]?.type).toBe("user");
});
