// SPIKE A (variant 2) — answer AskUserQuestion via the PreToolUse HOOK by
// pre-injecting the chosen answer into the tool input (updatedInput).
//
// WHY: run 1 (askq.mjs) proved that declaring supportedDialogKinds and ALLOWing
// the PreToolUse hook is NOT enough — AskUserQuestion's OWN checkPermissions
// returns {behavior:"ask", message:"Answer questions?"} which headless mode
// auto-denies (no client/dialog to answer), so the tool returns
// is_error tool_result "Answer questions?" and lands in permission_denials.
//
// The interactive UI's answer builder ($9m) produces a permission "allow" whose
// updatedInput is {...input, answers:{<question>:<label>}, annotations:{...}}.
// So the answer to AskUserQuestion IS an `answers` map merged into the tool
// input. This variant tests: can the PreToolUse hook ALLOW + rewrite the tool
// input to carry `answers` (and `annotations`), so the tool emits the picked
// option as its result and the model reflects the choice?
//
// Usage: node askq2.mjs <out.jsonl> [choice]   (choice default "TypeScript")
// Run from a THROWAWAY temp dir, never the repo. Subscription auth only.
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { argv, env } from "node:process";
import { randomUUID } from "node:crypto";

const outPath = argv[2] ?? "askq2-out.jsonl";
const CHOICE = argv[3] ?? "TypeScript";
const out = createWriteStream(outPath, { flags: "w" });

const PROMPT =
  "Use the AskUserQuestion tool to ask me whether I prefer TypeScript or Python, " +
  "with two options labeled exactly TypeScript and Python. After I answer, tell me " +
  "in one sentence which language I picked.";

function banner(s) { process.stdout.write(s); }
function record(obj) { out.write(JSON.stringify({ _dir: "out", ...obj }) + "\n"); }

const childEnv = { ...env };
delete childEnv.ANTHROPIC_API_KEY;

const child = spawn(
  "claude",
  [
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--include-hook-events",
    "--permission-mode", "default",
    "--session-id", randomUUID(),
  ],
  { cwd: process.cwd(), env: childEnv, stdio: ["pipe", "pipe", "pipe"] },
);

const KILL_AFTER_MS = 180_000;
const killTimer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, KILL_AFTER_MS);

function write(obj) {
  record(obj);
  child.stdin.write(JSON.stringify(obj) + "\n");
}

let buf = "";
let userSent = false;
const answeredHooks = new Set();
let answeredAskQ = false;

function sendUser() {
  if (userSent) return;
  userSent = true;
  const userMsg = { type: "user", message: { role: "user", content: [{ type: "text", text: PROMPT }] } };
  banner(`\n>>> SENDING user message:\n${JSON.stringify(userMsg)}\n`);
  write(userMsg);
}

// Build {answers, annotations} for the picked option, mirroring binary fn $9m.
function buildAnswers(toolInput) {
  const questions = toolInput?.questions ?? [];
  const answers = {};
  const annotations = {};
  for (const q of questions) {
    const opts = q.options ?? [];
    const picked = opts.find((o) => o.label === CHOICE) ?? opts[0];
    const label = picked?.label ?? CHOICE;
    answers[q.question] = label;
    if (picked?.description) annotations[q.question] = { preview: picked.description };
  }
  return { answers, annotations };
}

// Plain allow (for non-AskUserQuestion tools, if any).
function hookAllow(requestId, updatedInput) {
  const hookSpecificOutput = {
    hookEventName: "PreToolUse",
    permissionDecision: "allow",
    permissionDecisionReason: "spike auto-allow",
  };
  if (updatedInput) hookSpecificOutput.updatedInput = updatedInput;
  return {
    type: "control_response",
    response: {
      subtype: "success",
      request_id: requestId,
      response: { async: false, hookSpecificOutput },
    },
  };
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
    try { msg = JSON.parse(line); } catch { continue; }

    if (msg.type === "control_response" && !userSent) { sendUser(); continue; }

    if (msg.type === "control_request") {
      const reqId = msg.request_id ?? msg.id;
      const sub = msg.request?.subtype;
      if (sub === "hook_callback" && !answeredHooks.has(reqId)) {
        answeredHooks.add(reqId);
        const tool = msg.request?.input?.tool_name ?? "?";
        const toolInput = msg.request?.input?.tool_input ?? {};
        if (tool === "AskUserQuestion") {
          answeredAskQ = true;
          const { answers, annotations } = buildAnswers(toolInput);
          const updatedInput = { ...toolInput, answers, annotations };
          banner(`\n>>> AskUserQuestion hook → ALLOW + inject answers=${JSON.stringify(answers)}\n    updatedInput=${JSON.stringify(updatedInput)}\n`);
          write(hookAllow(reqId, updatedInput));
        } else {
          banner(`\n>>> hook_callback tool=${tool} → plain ALLOW\n`);
          write(hookAllow(reqId));
        }
      } else {
        banner(`\n>>> control_request subtype=${sub} (not answered)\n`);
      }
    }

    if (msg.type === "assistant") {
      for (const block of msg.message?.content ?? []) {
        if (block.type === "text") banner(`\n>>> ASSISTANT TEXT: ${block.text}\n`);
        if (block.type === "tool_use") banner(`\n>>> ASSISTANT TOOL_USE: ${block.name} input=${JSON.stringify(block.input)}\n`);
      }
    }
    if (msg.type === "user" && msg._dir !== "out") {
      for (const block of msg.message?.content ?? []) {
        if (block.type === "tool_result") banner(`\n>>> TOOL_RESULT (is_error=${block.is_error}): ${JSON.stringify(block.content)}\n`);
      }
    }

    if (msg.type === "result") {
      banner(`\n>>> RESULT subtype=${msg.subtype} result=${JSON.stringify(msg.result)}\n    denials=${JSON.stringify(msg.permission_denials)}\n`);
      clearTimeout(killTimer);
      setTimeout(() => { try { child.stdin.end(); } catch {} }, 1000);
    }
  }
});

child.stderr.on("data", (c) => process.stderr.write(c));
child.on("exit", (code, signal) => {
  clearTimeout(killTimer);
  out.end();
  process.stderr.write(`\n[child exit code=${code} signal=${signal} answeredAskQ=${answeredAskQ}]\n`);
  process.exitCode = 0;
});

const initReq = {
  type: "control_request",
  request_id: `init-${randomUUID()}`,
  request: {
    subtype: "initialize",
    supportedDialogKinds: ["permission_ask_user_question"],
    hooks: { PreToolUse: [{ matcher: "", hookCallbackIds: ["hook_0"] }] },
  },
};
banner(`>>> SENDING initialize control_request:\n${JSON.stringify(initReq)}\n`);
write(initReq);
