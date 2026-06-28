// Status-honesty audit: fold a LIVE stream-json fixture through the REAL pipeline
// (protocol/dist parseLine → web/src reduceFrame) and, for each frame, compare the label the user would
// see (the ChatTelemetry logic, mirrored here) against the GENUINE activity derived from the raw frames.
// Flags any "lie": a label that misrepresents what Claude is actually doing at that moment.
//
//   usage: npx tsx scripts/spike/status-audit.mjs <fixture.jsonl> [--verbose]
//
// "Genuine activity" is derived independently of the reducer (from the raw event stream), so this is a
// real cross-check, not a tautology: spinup (turn picked up, no block yet) | thinking | streaming | tool |
// awaiting | done | idle(no turn).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "../..");
const { parseLine } = await import(resolve(ROOT, "packages/protocol/dist/index.js"));
const { emptyView, reduceFrame } = await import(resolve(ROOT, "packages/web/src/store/frame-reducer.ts"));

const fixture = process.argv[2];
const verbose = process.argv.includes("--verbose");
if (!fixture) {
  console.error("usage: status-audit.mjs <fixture.jsonl> [--verbose]");
  process.exit(2);
}

// ── displayed label = the EXACT ChatTelemetry logic ────────────────────────────────────────────────────
const LABEL = {
  idle: "Ready",
  dormant: "Dormant",
  thinking: "Thinking",
  streaming: "Streaming",
  awaiting: "Awaiting you",
  "running-tool": "Running tool",
  success: "Done",
  error: "Error",
};
function displayedLabel(v) {
  const bridging = !!v.awaitingReply && (v.wireState === "idle" || v.wireState === "success");
  return bridging ? "Thinking…" : LABEL[v.wireState];
}

// ── genuine activity, derived from the RAW frames (independent of the reducer) ──────────────────────────
// The phase is STICKY (it persists until the next content block opens or the turn ends), because the model
// stays in that phase through the bookkeeping frames (message_delta/stop, content_block_stop, the post-tool
// gap) — exactly what an honest status should keep showing. We simulate a delivered SEND, so the turn is in
// flight from frame 1 (pre-first-block init frames are legitimately "spinup").
function makeGenuineTracker() {
  let phase = "spinup"; // spinup | thinking | streaming | tool | done
  let awaiting = false;
  return {
    apply(raw) {
      const t = raw.type;
      if (t === "stream_event") {
        const e = raw.event || {};
        if (e.type === "content_block_start") {
          const b = e.content_block?.type;
          if (b === "thinking" || b === "redacted_thinking") phase = "thinking";
          else if (b === "text") phase = "streaming";
          // a tool_use block-start is the call being COMPOSED (not executing) → keep the prior phase; "tool"
          // is set only at the finalized assistant tool_use below (the dispatched call).
        }
        // message_delta/stop, content_block_stop, signature/input_json deltas → phase is STICKY (no change).
      } else if (t === "assistant") {
        // A finalized assistant message with a tool_use is the tool-use loop; a text/thinking-only finalize
        // doesn't move us OUT of the streamed phase. Only escalate to "tool" if it carries a tool_use.
        const blocks = raw.message?.content ?? [];
        if (blocks.some((b) => b.type === "tool_use")) phase = "tool";
        else if (phase === "spinup") phase = blocks.some((b) => b.type === "thinking") ? "thinking" : "streaming";
      } else if (t === "result") {
        phase = "done";
      }
      // production expresses a permission gate as a separate ServerFrame; a raw stream uses control_request.
      if (t === "control_request" && raw.request?.subtype === "can_use_tool") awaiting = true;
      if (t === "control_response") awaiting = false;
    },
    genuine() {
      if (awaiting) return "awaiting";
      return phase;
    },
  };
}

// A displayed label is HONEST for a given genuine activity iff it's in the allowed set.
const HONEST = {
  spinup: new Set(["Thinking…", "Thinking"]), // working, no specific block yet
  thinking: new Set(["Thinking…", "Thinking"]),
  streaming: new Set(["Streaming"]),
  tool: new Set(["Running tool", "Streaming"]), // tool loop may interleave streamed text between calls
  awaiting: new Set(["Awaiting you"]),
  done: new Set(["Done"]),
  idle: new Set(["Ready", "Done"]),
};

// LIVE path: simulate a delivered send — awaitingReply set, prior turn 'success'.
let view = { ...emptyView(), wireState: "success", awaitingReply: true };
const tracker = makeGenuineTracker();
let seq = 0;
const lies = [];
const rows = [];
for (const line of readFileSync(fixture, "utf8").split("\n")) {
  if (!line.trim()) continue;
  const raw = JSON.parse(line);
  if (raw._dir === "out") continue; // skip our own outbound echoes if present
  tracker.apply(raw);
  const ev = parseLine(line);
  if (!ev) continue;
  const kind = ev.type === "result" ? "result" : ev.type === "exit" ? "exit" : "event";
  view = reduceFrame(view, { seq: ++seq, kind, payload: ev });
  const genuine = tracker.genuine();
  const shown = displayedLabel(view);
  const honest = HONEST[genuine]?.has(shown) ?? false;
  let tag = ev.type;
  if (ev.type === "stream_event")
    tag += "/" + (ev.event?.type || "?") + (ev.event?.delta?.type ? "/" + ev.event.delta.type : "");
  rows.push({ tag, genuine, shown, honest });
  if (!honest) lies.push({ seq, tag, genuine, shown });
}

// Print: collapse consecutive identical (genuine, shown) rows for readability.
if (verbose) {
  let prev = "";
  for (const r of rows) {
    const key = r.genuine + "|" + r.shown;
    if (key === prev) continue;
    prev = key;
    console.log(`  ${r.honest ? "✅" : "❌"} ${r.tag.padEnd(44)} genuine=${r.genuine.padEnd(9)} shown="${r.shown}"`);
  }
}
console.log(`\n${fixture.split("/").pop()}: ${rows.length} frames, ${lies.length} dishonest.`);
if (lies.length) {
  for (const l of lies) console.log(`  ❌ seq ${l.seq} ${l.tag}: genuine=${l.genuine} but shown="${l.shown}"`);
  process.exitCode = 1;
} else {
  console.log("  ✅ every frame's status honestly matched genuine activity.");
}
