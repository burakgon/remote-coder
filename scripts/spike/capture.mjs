// Generic QA capture harness for remote-coder.
//
// Drives the REAL `claude` binary in bidirectional stream-json mode with the
// EXACT production spawn args (see packages/server/src/config.ts buildClaudeArgs),
// most importantly `--replay-user-messages` (the server uses it; the older spike
// scripts did NOT, so their fixtures diverged from production). Captures every
// CLI stdout line verbatim into a jsonl (outbound messages tagged `_dir:"out"`),
// runs a multi-turn script of prompts, and auto-answers EVERY PreToolUse
// hook_callback so tools actually execute (or are denied) — letting us capture
// real tool_use / tool_result / thinking / image / error / compaction shapes.
//
// Usage:
//   node capture.mjs <config.json>
//
// config.json:
//   {
//     "out": "/abs/path/live.jsonl",     // verbatim live capture (required)
//     "sessionId": "<uuid>",             // fixed id so the transcript is locatable (required)
//     "prompts": ["...", "..."],          // one per turn, keep-alive multiturn (required)
//     "permission": "allow"|"deny"|"ack", // hook decision for ALL tools (default "allow")
//     "maxThinkingTokens": 8000,          // optional: enable extended thinking
//     "model": "claude-...",              // optional: --model
//     "killAfterMs": 180000               // optional global watchdog (default 180s)
//   }
//
// Run from a THROWAWAY temp dir (cwd = where tools execute). Subscription auth only.
import { spawn } from "node:child_process";
import { createWriteStream, readFileSync } from "node:fs";
import { argv, env, cwd } from "node:process";
import { randomUUID } from "node:crypto";

const cfgPath = argv[2];
if (!cfgPath) {
  process.stderr.write("usage: node capture.mjs <config.json>\n");
  process.exit(2);
}
const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
const outPath = cfg.out;
const sessionId = cfg.sessionId ?? randomUUID();
const prompts = Array.isArray(cfg.prompts) ? cfg.prompts : [];
const permission = cfg.permission ?? "allow";
const killAfterMs = cfg.killAfterMs ?? 180_000;
if (!outPath || prompts.length === 0) {
  process.stderr.write("config must have { out, prompts: [...] }\n");
  process.exit(2);
}

const out = createWriteStream(outPath, { flags: "w" });
function banner(s) {
  process.stderr.write(s);
}
function record(obj) {
  out.write(JSON.stringify({ _dir: "out", ...obj }) + "\n");
}

// Subscription auth only: never pass an API key.
const childEnv = { ...env };
delete childEnv.ANTHROPIC_API_KEY;
// Enable file checkpointing so rewind-relevant transcript shapes match production.
childEnv.CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING = "true";

// EXACT production args minus resume (this is always a fresh --session-id capture).
const args = [
  "--input-format",
  "stream-json",
  "--output-format",
  "stream-json",
  "--verbose",
  "--include-partial-messages",
  "--include-hook-events",
  "--replay-user-messages",
  "--session-id",
  sessionId,
  "--permission-mode",
  "default",
];
if (cfg.model) args.push("--model", cfg.model);

const child = spawn("claude", args, { cwd: cwd(), env: childEnv, stdio: ["pipe", "pipe", "pipe"] });

let killTimer = setTimeout(() => {
  banner(`\n>>> WATCHDOG ${killAfterMs}ms — killing child\n`);
  finish("watchdog");
}, killAfterMs);
function bumpWatchdog() {
  clearTimeout(killTimer);
  killTimer = setTimeout(() => {
    banner(`\n>>> WATCHDOG ${killAfterMs}ms (idle) — killing child\n`);
    finish("watchdog-idle");
  }, killAfterMs);
}

function write(obj) {
  record(obj);
  child.stdin.write(JSON.stringify(obj) + "\n");
}

function hookResponse(requestId, toolName) {
  const base = { subtype: "success", request_id: requestId };
  if (permission === "ack") {
    return { type: "control_response", response: { ...base, response: { async: false } } };
  }
  const decision = permission === "deny" ? "deny" : "allow";
  return {
    type: "control_response",
    response: {
      ...base,
      response: {
        async: false,
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: decision,
          permissionDecisionReason: `qa auto-${decision} (${toolName})`,
        },
      },
    },
  };
}

let buf = "";
let initialized = false;
let promptIdx = 0;
let done = false;
const answeredHooks = new Set();

let interruptSent = false;
function sendNextPromptOrFinish() {
  if (promptIdx >= prompts.length) {
    finish("all-prompts-done");
    return;
  }
  const text = prompts[promptIdx++];
  const userMsg = { type: "user", message: { role: "user", content: [{ type: "text", text }] } };
  banner(`\n>>> SEND prompt ${promptIdx}/${prompts.length}: ${JSON.stringify(text).slice(0, 80)}\n`);
  write(userMsg);
  // Optional: interrupt (STOP) this turn after a delay to capture an aborted/"stopped" result.
  if (typeof cfg.interruptAfterMs === "number" && !interruptSent) {
    interruptSent = true;
    setTimeout(() => {
      banner(`>>> INTERRUPT after ${cfg.interruptAfterMs}ms\n`);
      write({ type: "control_request", request_id: `int-${randomUUID()}`, request: { subtype: "interrupt" } });
    }, cfg.interruptAfterMs);
  }
}

function finish(why) {
  if (done) return;
  done = true;
  clearTimeout(killTimer);
  banner(`\n>>> FINISH (${why}); session=${sessionId}; closing stdin\n`);
  try {
    child.stdin.end();
  } catch {
    /* already closed */
  }
  setTimeout(() => {
    try {
      child.kill("SIGKILL");
    } catch {}
  }, 5000);
}

child.stdout.on("data", (chunk) => {
  const text = chunk.toString("utf8");
  out.write(text);
  bumpWatchdog();
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

    // CLI's reply to our initialize → optionally set thinking budget, then send prompt 1.
    if (msg.type === "control_response" && !initialized) {
      initialized = true;
      if (typeof cfg.maxThinkingTokens === "number") {
        const req = {
          type: "control_request",
          request_id: `think-${randomUUID()}`,
          request: {
            subtype: "set_max_thinking_tokens",
            max_thinking_tokens: cfg.maxThinkingTokens,
            ...(cfg.thinkingDisplay ? { thinking_display: cfg.thinkingDisplay } : {}),
          },
        };
        banner(`>>> SET max_thinking_tokens=${cfg.maxThinkingTokens}\n`);
        write(req);
      }
      sendNextPromptOrFinish();
      continue;
    }

    if (msg.type === "control_request") {
      const reqId = msg.request_id ?? msg.id;
      const sub = msg.request?.subtype;
      if (sub === "hook_callback" && !answeredHooks.has(reqId)) {
        answeredHooks.add(reqId);
        const tool = msg.request?.input?.tool_name ?? "?";
        banner(`>>> HOOK ${permission} tool=${tool} reqId=${reqId}\n`);
        write(hookResponse(reqId, tool));
      } else if (sub === "can_use_tool") {
        const reply = {
          type: "control_response",
          response: {
            subtype: "success",
            request_id: reqId,
            response: { behavior: "allow", updatedInput: msg.request?.input ?? {} },
          },
        };
        write(reply);
      }
    }

    if (msg.type === "result") {
      banner(`>>> RESULT subtype=${msg.subtype}\n`);
      // Next turn on the SAME process (keep-alive), or finish after the last prompt.
      setTimeout(() => sendNextPromptOrFinish(), 300);
    }
  }
});

child.stderr.on("data", (c) => process.stderr.write(c));
child.on("exit", (code, signal) => {
  clearTimeout(killTimer);
  out.end();
  process.stderr.write(`\n[exit code=${code} signal=${signal}] session=${sessionId}\n`);
  process.exitCode = 0;
});

// Step 1: initialize handshake (register PreToolUse hook so tools surface to us).
const initReq = {
  type: "control_request",
  request_id: `init-${randomUUID()}`,
  request: { subtype: "initialize", hooks: { PreToolUse: [{ matcher: "", hookCallbackIds: ["hook_0"] }] } },
};
banner(`>>> INIT session=${sessionId} cwd=${cwd()}\n`);
write(initReq);
