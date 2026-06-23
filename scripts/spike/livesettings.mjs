// Live-settings spike for remote-coder Plan 5 Task 8.
//
// QUESTION: in a bidirectional stream-json keep-alive session (initialize
// handshake + one live turn), does the REAL `claude` binary ACCEPT mid-session
// client→CLI control_requests that change live settings, and what are the EXACT
// request field names? We verify three:
//
//   1. set_model               { subtype, model }
//   2. set_max_thinking_tokens { subtype, max_thinking_tokens, thinking_display? }
//   3. set_permission_mode     { subtype, mode }
//
// Field names were first read out of the binary's own Zod schemas + main-loop
// control handler (v2.1.186):
//   set_model:               A.object({subtype:"set_model", model:A.string().optional()})
//   set_max_thinking_tokens: A.object({subtype:"set_max_thinking_tokens",
//                              max_thinking_tokens:A.number().nullable(),
//                              thinking_display:A.enum(["summarized","omitted"]).nullable().optional()})
//   set_permission_mode:     A.object({subtype:"set_permission_mode",
//                              mode:enum(["default","acceptEdits","bypassPermissions","plan","dontAsk","auto"]),
//                              ultraplan?:bool})
// The main-loop handler reads e.request.model / e.request.max_thinking_tokens /
// e.request.thinking_display / e.request.mode and replies success via
// {type:"control_response",response:{subtype:"success",request_id,response}}.
// This driver confirms that empirically and looks for an observable effect.
//
// FLOW:
//   1. initialize handshake (register a PreToolUse hook so a tool turn could be
//      answered; auto-allow any hook_callback that fires).
//   2. Turn 1: ask "what is 2+2" → first `result` makes the session live.
//   3. Send set_model (claude-sonnet-4-6) control_request; capture ACCEPT/REJECT.
//   4. Turn 2: ask the model to state its model id → check the new model is
//      reflected in assistant/result/init lines.
//   5. Send set_max_thinking_tokens (30000); capture ACCEPT/REJECT.
//   6. Send set_permission_mode (acceptEdits); capture ACCEPT/REJECT.
//   7. Turn 3: ask a tool-using Write → observe whether the system/init or
//      hook_callback input now reports permission_mode "acceptEdits".
//
// If a control_request is REJECTED (control_response subtype:"error"), we log
// the error verbatim and try documented alternates.
//
// Usage:  node livesettings.mjs <out.jsonl>
// Run from a THROWAWAY temp dir (/tmp/rc-spike-livesettings), never the repo.
// Subscription auth only — ANTHROPIC_API_KEY is deleted before spawn.
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { argv, env } from "node:process";
import { randomUUID } from "node:crypto";

const outPath = argv[2] ?? "livesettings-out.jsonl";
const out = createWriteStream(outPath, { flags: "w" });

const TARGET_MODEL = "claude-sonnet-4-6";

function banner(s) {
  process.stdout.write(s);
}
function record(obj) {
  out.write(JSON.stringify({ _dir: "out", ...obj }) + "\n");
}

// Subscription auth only: never pass an API key.
const childEnv = { ...env };
delete childEnv.ANTHROPIC_API_KEY;

const child = spawn(
  "claude",
  [
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--include-hook-events",
    "--permission-mode",
    "default",
    "--session-id",
    randomUUID(),
  ],
  { cwd: process.cwd(), env: childEnv, stdio: ["pipe", "pipe", "pipe"] },
);

const KILL_AFTER_MS = 240_000;
const killTimer = setTimeout(() => {
  banner(`\n>>> SAFETY TIMEOUT ${KILL_AFTER_MS}ms — killing child\n`);
  finish("safety-timeout");
}, KILL_AFTER_MS);

function write(obj) {
  record(obj);
  child.stdin.write(JSON.stringify(obj) + "\n");
}

function hookAllow(requestId, tool) {
  return {
    type: "control_response",
    response: {
      subtype: "success",
      request_id: requestId,
      response: {
        async: false,
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          permissionDecisionReason: `spike auto-allow ${tool ?? ""}`,
        },
      },
    },
  };
}

function controlReq(request) {
  const request_id = `ctl-${randomUUID()}`;
  return { request_id, msg: { type: "control_request", request_id, request } };
}

let buf = "";
let userSent = false;
let resultCount = 0;
const answeredHooks = new Set();
let done = false;

// Pending settings control_requests keyed by request_id → human label.
const pendingControl = new Map();
// Findings: subtype → { accepted, error, fields }
const findings = {
  set_model: null,
  set_max_thinking_tokens: null,
  set_permission_mode: null,
};
// Track the most recent model + permission_mode the CLI reports.
const observed = {
  initModels: [], // model on each system/init
  assistantModels: [], // model on each assistant message
  resultText: [], // result.result text per turn
  hookPermissionModes: [], // permission_mode seen in hook_callback inputs
};

function finish(why) {
  if (done) return;
  done = true;
  banner(`\n>>> FINISH (${why}); closing stdin\n`);
  clearTimeout(killTimer);
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

function sendUser(text, label) {
  const userMsg = { type: "user", message: { role: "user", content: [{ type: "text", text }] } };
  banner(`\n>>> SENDING ${label}: ${JSON.stringify(userMsg.message.content[0].text)}\n`);
  write(userMsg);
}

// --- Orchestration: a small step machine keyed on result count ----------------
// Turn 1 = warm up. After result #1: set_model → turn 2 (ask model). After
// result #2: set_max_thinking_tokens + set_permission_mode → turn 3 (Write).
// After result #3: print findings + finish.

function sendSetModel() {
  const { request_id, msg } = controlReq({ subtype: "set_model", model: TARGET_MODEL });
  pendingControl.set(request_id, { subtype: "set_model", fields: { subtype: "set_model", model: TARGET_MODEL } });
  banner(`\n>>> SENDING set_model control_request (model=${TARGET_MODEL}, reqId=${request_id})\n`);
  write(msg);
}

function sendSetMaxThinking() {
  const fields = { subtype: "set_max_thinking_tokens", max_thinking_tokens: 30000 };
  const { request_id, msg } = controlReq(fields);
  pendingControl.set(request_id, { subtype: "set_max_thinking_tokens", fields });
  banner(`\n>>> SENDING set_max_thinking_tokens control_request (max_thinking_tokens=30000, reqId=${request_id})\n`);
  write(msg);
}

function sendSetPermissionMode() {
  const fields = { subtype: "set_permission_mode", mode: "acceptEdits" };
  const { request_id, msg } = controlReq(fields);
  pendingControl.set(request_id, { subtype: "set_permission_mode", fields });
  banner(`\n>>> SENDING set_permission_mode control_request (mode=acceptEdits, reqId=${request_id})\n`);
  write(msg);
}

child.stdout.on("data", (chunk) => {
  const text = chunk.toString("utf8");
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

    // Track observed model / permission mode.
    if (msg.type === "system" && msg.subtype === "init") {
      observed.initModels.push(msg.model);
      banner(
        `\n>>> system/init model=${JSON.stringify(msg.model)} permissionMode=${JSON.stringify(msg.permissionMode)}\n`,
      );
    }
    if (msg.type === "assistant" && msg.message?.model) {
      observed.assistantModels.push(msg.message.model);
    }

    // Reply to our initialize handshake → send user message 1.
    if (msg.type === "control_response" && !userSent && !pendingControl.size) {
      userSent = true;
      sendUser("What is 2+2? Reply with just the number.", "turn 1 (warm up)");
      continue;
    }

    // control_response to one of OUR settings control_requests.
    if (msg.type === "control_response" && msg.response?.request_id && pendingControl.has(msg.response.request_id)) {
      const reqId = msg.response.request_id;
      const meta = pendingControl.get(reqId);
      pendingControl.delete(reqId);
      const sub = msg.response.subtype;
      const accepted = sub === "success";
      const errorText = msg.response.error ?? null;
      findings[meta.subtype] = { accepted, error: errorText, fields: meta.fields, raw: msg.response };
      banner(
        `\n>>> CONTROL_RESPONSE for ${meta.subtype}: subtype=${sub} ${accepted ? "ACCEPTED" : `REJECTED error=${JSON.stringify(errorText)}`}\n`,
      );
      continue;
    }

    // Defensive: answer any hook_callback (tool turns trigger one).
    if (msg.type === "control_request") {
      const reqId = msg.request_id ?? msg.id;
      const sub = msg.request?.subtype;
      if (sub === "hook_callback" && !answeredHooks.has(reqId)) {
        answeredHooks.add(reqId);
        const tool = msg.request?.input?.tool_name ?? "?";
        const pmode = msg.request?.input?.permission_mode;
        if (pmode !== undefined) observed.hookPermissionModes.push(pmode);
        banner(`\n>>> hook_callback tool=${tool} permission_mode=${JSON.stringify(pmode)} → auto-allow\n`);
        write(hookAllow(reqId, tool));
      } else {
        banner(`\n>>> OBSERVED control_request subtype=${sub} (not answered)\n`);
      }
    }

    if (msg.type === "result") {
      resultCount += 1;
      observed.resultText.push(msg.result);
      banner(
        `\n>>> RESULT #${resultCount} subtype=${msg.subtype} result=${JSON.stringify(msg.result)} permission_denials=${JSON.stringify(msg.permission_denials)}\n`,
      );

      if (resultCount === 1) {
        // Session is live. Try set_model, then ask the model who it is.
        setTimeout(() => {
          sendSetModel();
          setTimeout(() => {
            sendUser(
              "What model are you? Reply with ONLY your exact model id string (e.g. claude-sonnet-4-6 or claude-opus-4-8), nothing else.",
              "turn 2 (report model)",
            );
          }, 800);
        }, 400);
      } else if (resultCount === 2) {
        // Now try set_max_thinking_tokens + set_permission_mode, then a tool turn.
        setTimeout(() => {
          sendSetMaxThinking();
          setTimeout(() => {
            sendSetPermissionMode();
            setTimeout(() => {
              sendUser(
                "Use the Write tool to create a file named spike.txt containing the text hello",
                "turn 3 (Write — observe permission_mode)",
              );
            }, 800);
          }, 800);
        }, 400);
      } else if (resultCount >= 3) {
        printFindings();
        finish("all-turns-done");
      }
    }
  }
});

function printFindings() {
  banner("\n\n================= FINDINGS =================\n");
  for (const k of Object.keys(findings)) {
    const f = findings[k];
    if (!f) {
      banner(`${k}: NO RESPONSE SEEN\n`);
      continue;
    }
    banner(
      `${k}: ${f.accepted ? "ACCEPTED" : "REJECTED"} fields=${JSON.stringify(f.fields)}${f.error ? ` error=${JSON.stringify(f.error)}` : ""}\n`,
    );
  }
  banner(`\ninit models per turn: ${JSON.stringify(observed.initModels)}\n`);
  banner(`assistant models: ${JSON.stringify([...new Set(observed.assistantModels)])}\n`);
  banner(`result text per turn: ${JSON.stringify(observed.resultText)}\n`);
  banner(`hook permission_modes observed: ${JSON.stringify(observed.hookPermissionModes)}\n`);
  banner("===========================================\n");
}

child.stderr.on("data", (c) => process.stderr.write(c));
child.on("exit", (code, signal) => {
  clearTimeout(killTimer);
  out.end();
  process.stderr.write(`\n[child exit code=${code} signal=${signal} resultCount=${resultCount}]\n`);
  process.exitCode = 0;
});

// Step 1: send the initialize control handshake (register PreToolUse hook).
const initReq = {
  type: "control_request",
  request_id: `init-${randomUUID()}`,
  request: { subtype: "initialize", hooks: { PreToolUse: [{ matcher: "", hookCallbackIds: ["hook_0"] }] } },
};
banner(`>>> SENDING initialize control_request\n`);
write(initReq);
