// De-risk spike driver for remote-coder.
//
// Drives the REAL `claude` binary in bidirectional stream-json mode, logs
// EVERY stdout line verbatim to argv[2], and exercises the control protocol:
//
//   1. Sends an `initialize` control_request (the SDK handshake) that
//      registers a PreToolUse hook. The CLI replies with a `control_response`
//      carrying its session capabilities (commands/agents/models/account/...).
//   2. Sends the user message.
//   3. When the model calls a tool, the CLI sends a `hook_callback`
//      control_request (because we registered a PreToolUse hook). We answer
//      with a `control_response` whose `hookSpecificOutput.permissionDecision`
//      ALLOWS the tool — so the tool actually executes.
//
// WHY a hook and not `can_use_tool`:
//   In headless stream-json mode, an un-gated tool in `--permission-mode
//   default` is AUTO-DENIED (the binary's "headless-agent auto-deny" path) and
//   no `can_use_tool` control_request is emitted to stdout — that direct
//   permission-callback path is reserved for the CLI's interactive
//   bridge/Remote-Control session. A registered PreToolUse hook is the
//   mechanism that surfaces a real, answerable `control_request` over headless
//   stdio AND lets the client allow/deny the tool. See docs/protocol-notes.md.
//
// Usage:
//   node drive.mjs <out.jsonl> [prompt] [hookDecision]
//     hookDecision: "allow" (default) | "deny" | "ack"
//       allow → grants the tool (file gets written)
//       deny  → blocks the tool with a reason
//       ack   → plain {async:false} (no decision → falls through to auto-deny)
//
// Run from a THROWAWAY temp dir, never the repo.
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { argv, env } from "node:process";
import { randomUUID } from "node:crypto";

const outPath = argv[2] ?? "spike-out.jsonl";
const prompt = argv[3] ?? "Use the Write tool to create a file named spike.txt with the text hello";
const hookDecision = argv[4] ?? "allow";
// The fixture file gets ONLY pure protocol JSON, one object per line (both the
// CLI's stdout lines and the messages we send). Human-readable banners go to
// the console only, so the committed *.jsonl stays machine-parseable.
const out = createWriteStream(outPath, { flags: "w" });

// Console-only progress banner (never written to the fixture file).
function banner(s) {
  process.stdout.write(s);
}
// Record an outbound message we send to the CLI, as a pure JSON line in the
// fixture, tagged with `_dir:"out"` so direction is recoverable without
// breaking JSON parsing. (CLI→client lines are recorded verbatim, untagged.)
function record(obj) {
  out.write(JSON.stringify({ _dir: "out", ...obj }) + "\n");
}

// Subscription auth only: never pass an API key. The spike deletes any
// inherited key before spawning `claude`.
const childEnv = { ...env };
delete childEnv.ANTHROPIC_API_KEY;

const child = spawn(
  "claude",
  [
    // NOTE: no `-p`. Bidirectional stream-json keeps the session interactive
    // enough to round-trip control_requests; it still exits after the result.
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--include-hook-events",
    "--permission-mode",
    "default",
  ],
  { cwd: process.cwd(), env: childEnv, stdio: ["pipe", "pipe", "pipe"] },
);

// Safety timeout: kill the child if anything hangs the turn.
const KILL_AFTER_MS = 120_000;
const killTimer = setTimeout(() => {
  banner(`\n>>> TIMEOUT ${KILL_AFTER_MS}ms — killing child\n`);
  child.kill("SIGKILL");
}, KILL_AFTER_MS);

// Send a message to the CLI over stdin AND record it (pure JSON) in the fixture.
function write(obj) {
  record(obj);
  child.stdin.write(JSON.stringify(obj) + "\n");
}

function hookResponse(requestId) {
  const base = { subtype: "success", request_id: requestId };
  if (hookDecision === "ack") {
    return { type: "control_response", response: { ...base, response: { async: false } } };
  }
  const decision = hookDecision === "deny" ? "deny" : "allow";
  return {
    type: "control_response",
    response: {
      ...base,
      response: {
        async: false,
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: decision,
          permissionDecisionReason: `spike auto-${decision}`,
        },
      },
    },
  };
}

let buf = "";
let userSent = false;
let answeredHook = false;

function sendUserMessage() {
  if (userSent) return;
  userSent = true;
  const userMsg = { type: "user", message: { role: "user", content: [{ type: "text", text: prompt }] } };
  banner(`\n>>> SENDING user message:\n${JSON.stringify(userMsg)}\n`);
  write(userMsg);
}

child.stdout.on("data", (chunk) => {
  const text = chunk.toString("utf8");
  // Mirror the CLI's stdout verbatim to both the fixture file and the console.
  out.write(text);
  process.stdout.write(text);
  buf += text;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }

    // The CLI's reply to our initialize handshake → now send the user message.
    if (msg.type === "control_response" && !userSent) {
      sendUserMessage();
      continue;
    }

    if (msg.type === "control_request") {
      const reqId = msg.request_id ?? msg.id;
      const sub = msg.request?.subtype;
      if (sub === "hook_callback" && !answeredHook) {
        answeredHook = true;
        const reply = hookResponse(reqId);
        const tool = msg.request?.input?.tool_name ?? "?";
        banner(
          `\n>>> SENDING control_response (hook ${hookDecision} for tool=${tool}, reqId=${reqId}):\n${JSON.stringify(reply)}\n`,
        );
        write(reply);
      } else if (sub === "can_use_tool") {
        // The direct permission path, if the binary ever uses it over stdio.
        const reply = {
          type: "control_response",
          response: {
            subtype: "success",
            request_id: reqId,
            response: { behavior: "allow", updatedInput: msg.request?.input ?? {} },
          },
        };
        banner(`\n>>> SENDING control_response (can_use_tool allow, reqId=${reqId}):\n${JSON.stringify(reply)}\n`);
        write(reply);
      } else {
        banner(`\n>>> OBSERVED control_request subtype=${sub} (not answered)\n`);
      }
    }

    // The turn is complete. End stdin so the child exits cleanly (no timeout).
    if (msg.type === "result") {
      banner(`\n>>> RESULT (${msg.subtype}); closing stdin\n`);
      clearTimeout(killTimer);
      try {
        child.stdin.end();
      } catch {
        /* already closed */
      }
    }
  }
});

child.stderr.on("data", (c) => process.stderr.write(c));
child.on("exit", (code) => {
  clearTimeout(killTimer);
  out.end();
  process.stderr.write(`\n[exit ${code}]\n`);
});

// Step 1: send the initialize control handshake, registering a PreToolUse hook
// (matcher "" = all tools) so the CLI routes tool calls to us as
// `hook_callback` control_requests.
const initReq = {
  type: "control_request",
  request_id: `init-${randomUUID()}`,
  request: { subtype: "initialize", hooks: { PreToolUse: [{ matcher: "", hookCallbackIds: ["hook_0"] }] } },
};
banner(`>>> SENDING initialize control_request:\n${JSON.stringify(initReq)}\n`);
write(initReq);
