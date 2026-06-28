// Reopen-honesty audit: for EVERY truncation point of a LIVE fixture, simulate what a chat REOPENED at
// that instant would show, and compare to the genuine in-flight phase. Models the production reopen path:
//   server: ReplayBuffer (DROPS stream_event) → liveStateFromBuffer → { turnActive, liveWire } ; ORed with
//           the record's `turnInFlight` (true from send until result/exit — set before the CLI echoes).
//   client: seed = awaiting ? "awaiting" : turnActive ? (liveWire ?? "thinking") : "idle".
// A reopen is HONEST iff: a genuinely-executing tool ⇒ "running-tool"; thinking/streaming/spin-up ⇒
// "thinking" (working, never a fabricated tool); a settled turn ⇒ "idle".
//
//   usage: npx tsx scripts/spike/reopen-audit.mjs <fixture.jsonl> [...]   (needs packages/server/dist built)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "../..");
const { parseLine } = await import(resolve(ROOT, "packages/protocol/dist/index.js"));
const { liveStateFromBuffer } = await import(resolve(ROOT, "packages/server/dist/index.js"));

const isTransient = (ev) => ev.type === "stream_event"; // mirror ReplayBuffer.isTransient
const toFrame = (ev, seq) => ({
  seq,
  kind: ev.type === "result" ? "result" : ev.type === "exit" ? "exit" : "event",
  payload: ev,
});
// client reopen seed (mirror of store.ts loadHistory)
const reopenWire = (live) => (live.turnActive ? (live.liveWire ?? "thinking") : "idle");

// genuine phase from the RAW prefix (independent of the server derivation)
function genuineAt(raws) {
  let phase = "spinup"; // a turn is in flight from frame 1 (the client already sent)
  const openTool = new Set();
  for (const o of raws) {
    if (o.type === "stream_event") {
      const e = o.event || {};
      if (e.type === "content_block_start") {
        const b = e.content_block?.type;
        if (b === "thinking" || b === "redacted_thinking") phase = "thinking";
        else if (b === "text") phase = "streaming";
        // a tool_use block-start is the call being COMPOSED, not executing → keep prior phase; "tool" is set
        // only at the finalized assistant tool_use (the dispatched call the buffer can actually see).
      }
    } else if (o.type === "assistant") {
      for (const b of o.message?.content ?? []) if (b.type === "tool_use") openTool.add(b.id);
      if ((o.message?.content ?? []).some((b) => b.type === "tool_use")) phase = "tool";
    } else if (o.type === "user") {
      for (const b of o.message?.content ?? []) if (b.type === "tool_result") openTool.delete(b.tool_use_id);
      if (openTool.size === 0 && phase === "tool") phase = "thinking";
    } else if (o.type === "result") {
      phase = "done";
      openTool.clear();
    }
  }
  return phase;
}
function honest(genuine, seed) {
  if (genuine === "tool") return seed === "running-tool";
  if (genuine === "thinking" || genuine === "streaming" || genuine === "spinup") return seed === "thinking";
  return seed === "idle"; // done
}

let total = 0;
let lies = 0;
for (const fx of process.argv.slice(2)) {
  // Inbound only — drop our own outbound (`_dir:"out"`) lines so `evs` and `raws` stay index-aligned (the
  // server never buffers what it sent TO the CLI). Filtering only one of them misaligns the prefix slices.
  const lines = readFileSync(fx, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .filter((l) => JSON.parse(l)._dir !== "out");
  const evs = lines.map((l) => parseLine(l));
  const raws = lines.map((l) => JSON.parse(l));
  let bad = 0;
  for (let n = 1; n <= evs.length; n++) {
    const buf = [];
    let seq = 0;
    // Production: turnInFlight is set ONCE at send (before frame 1) and cleared at the turn's result/exit —
    // it is NOT re-set by trailing bookkeeping frames. (These fixtures are single-turn.)
    let turnInFlight = true;
    for (let i = 0; i < n; i++) {
      const ev = evs[i];
      if (!ev) continue;
      if (ev.type === "result" || ev.type === "exit") turnInFlight = false;
      if (isTransient(ev)) continue;
      buf.push(toFrame(ev, ++seq));
    }
    const live = liveStateFromBuffer(buf);
    if (turnInFlight) live.turnActive = true; // getHistory ORs the record's turnInFlight
    const seed = reopenWire(live);
    const genuine = genuineAt(raws.slice(0, n));
    total++;
    if (!honest(genuine, seed)) {
      bad++;
      lies++;
      if (bad <= 4)
        console.log(
          `  ❌ ${fx.split("/").pop()} @${n}: genuine=${genuine} seed=${seed} (turnActive=${live.turnActive}, liveWire=${live.liveWire})`,
        );
    }
  }
  console.log(`${fx.split("/").pop()}: ${evs.length} reopen points, ${bad} dishonest`);
}
console.log(`\nTOTAL: ${total} reopen points, ${lies} dishonest.`);
if (lies) process.exitCode = 1;
