/**
 * FIXTURE-BACKED regression for the spool MERGE duplication bugs (CRITICAL-1/2, HIGH-1).
 *
 * Uses a REAL captured CLI scenario (fixtures/qa/text-markdown.{live,transcript}.jsonl) folded through the
 * real production paths (liveFramesFromLines → spool, parseTranscript → hub history) and the REAL web
 * frame-reducer. The end-to-end assertion is the one the review demanded: after the spool merge over the
 * transcript history PLUS the WS `?since` delta replay, each user prompt AND each assistant text renders
 * EXACTLY ONCE (no duplicate "You" bubble, no duplicate assistant turn). A second case locks the
 * CRITICAL-1 guard directly: a synthesized uuid-LESS live echo (the shape the real CLI emits, which can't
 * be deduped against the uuid-bearing transcript) is REJECTED by the spool, so it can never duplicate.
 */
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { expect, test } from "vitest";
import { SessionManager, SessionHub, inMemoryFrameSpool } from "../src/index.js";
import { parseTranscript } from "../src/transcript.js";
import type { TranscriptTurn } from "@remote-coder/protocol";
import { liveFramesFromLines } from "./qa-replay.harness.js";
import { reduceFrame, emptyView, type SessionView } from "../../web/src/store/frame-reducer.js";
import type { ServerFrame } from "../../web/src/types/server.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const QA = join(HERE, "fixtures", "qa");
const MOCK = join(HERE, "helpers", "mock-claude-interactive.mjs");

function managerFor(): SessionManager {
  return new SessionManager(
    { claudeBin: process.execPath },
    { spawnPrefixArgs: [MOCK], baseEnv: { ...process.env, MOCK_MODE: "simple" }, startTimeoutMs: 5000 },
  );
}

const NOW = 10_000_000_000;
const RECENT = NOW - 60_000;

function fakeHistory(turns: TranscriptTurn[]) {
  return {
    read: async () => turns,
    readSubagents: () => [],
    resolveTranscriptPath: () => (turns.length > 0 ? "/fake/t.jsonl" : undefined),
    transcriptPath: () => "/fake",
  };
}
function storeWith(id: string) {
  const rows = [
    { id, cwd: "/work", dangerouslySkip: false, status: "dormant", createdAt: RECENT - 1, lastActivityAt: RECENT },
  ];
  return {
    list: () => rows,
    delete: () => {},
    upsert: () => {},
    get: (k: string) => rows.find((r) => r.id === k),
    setStatus: () => {},
    touch: () => {},
    close: () => {},
    mode: "memory-fallback" as const,
  };
}

/** Count user prompts (by text) and assistant texts a user would SEE in a folded view. */
function renderCounts(view: SessionView): { users: string[]; assistants: string[] } {
  const users: string[] = [];
  const assistants: string[] = [];
  for (const t of view.turns) {
    if (t.kind === "user") {
      const text = t.blocks
        .filter((b) => b.type === "text")
        .map((b) => (b as { text: string }).text)
        .join("");
      if (text.trim()) users.push(text.trim());
    } else if (t.kind === "assistant-text" && t.text.trim()) {
      assistants.push(t.text.trim());
    }
  }
  return { users, assistants };
}

test("text-markdown fixture: spool MERGE over transcript renders each user prompt + assistant text EXACTLY once", async () => {
  const id = "fixture-md";
  const liveLines = readFileSync(join(QA, "text-markdown.live.jsonl"), "utf8").split("\n");
  const transcriptJsonl = readFileSync(join(QA, "text-markdown.transcript.jsonl"), "utf8");
  const transcriptTurns = parseTranscript(transcriptJsonl);

  // 1. Spool the live frames — exactly as the live process would (the spool self-filters via isSpoolable).
  const spool = inMemoryFrameSpool();
  const liveFrames = liveFramesFromLines(liveLines);
  // ADVERSARIAL: also inject the uuid-LESS live user/assistant echoes the real CLI emits on the wire
  // (the exact CRITICAL-1 shape) — the spool MUST reject them so they can't duplicate on merge.
  const noUuidEchoes: ServerFrame[] = [
    {
      seq: 9001,
      kind: "event",
      payload: { type: "user", message: { content: "Output ONLY this as markdown, nothing else" } },
    },
    {
      seq: 9002,
      kind: "event",
      payload: { type: "assistant", message: { content: [{ type: "text", text: "## Demo" }] } },
    },
  ];
  for (const f of [...liveFrames, ...noUuidEchoes]) spool.append(id, f as unknown as ServerFrame);

  // The uuid-less echoes were NOT spooled (only uuid-bearing user/assistant + critical kinds are).
  const spooledMessages = spool.read(id).filter((f) => {
    const t = (f.payload as { type?: string }).type;
    return f.kind === "event" && (t === "user" || t === "assistant");
  });
  expect(spooledMessages.every((f) => typeof (f.payload as { uuid?: string }).uuid === "string")).toBe(true);

  // 2. Reopen through the real hub: transcript history + spool MERGE (bounded by sinceSeq).
  const hub = new SessionHub(managerFor(), {
    spool,
    history: fakeHistory(transcriptTurns) as never,
    store: storeWith(id) as never,
    now: () => NOW,
  });
  hub.loadFromStore();
  const { history, sinceSeq } = await hub.getHistory(id);

  // 3. Fold the returned history, THEN apply the WS `?since=sinceSeq` delta replay (the live frames the
  //    client would also receive), through the REAL reducer — this is what the client actually renders.
  let view = emptyView();
  for (const f of history) view = reduceFrame(view, f as unknown as Parameters<typeof reduceFrame>[1]);
  for (const f of liveFrames) {
    if (f.seq > sinceSeq) view = reduceFrame(view, f as unknown as Parameters<typeof reduceFrame>[1]);
  }

  // 4. Each distinct user prompt and assistant text appears EXACTLY once (no duplicate "You" bubble, no
  //    duplicate assistant turn).
  const { users, assistants } = renderCounts(view);
  expect(new Set(users).size).toBe(users.length); // no duplicated user prompt
  expect(new Set(assistants).size).toBe(assistants.length); // no duplicated assistant text
  // And the real content is present (the prompt + the markdown reply).
  expect(users.some((u) => u.includes("Output ONLY this as markdown"))).toBe(true);
  expect(assistants.some((a) => a.includes("Demo"))).toBe(true);

  spool.close();
});
