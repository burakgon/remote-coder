// SPIKE B — resume across process death + transcript/history location.
//
// remote-coder is a daemon; after a restart it must resume a session and show
// its history. This proves:
//   1. A first process with a FIXED --session-id establishes a codeword, then
//      stdin closes → process exits.
//   2. A SECOND process (`claude --resume <same id>`, stream-json, same cwd)
//      recalls the codeword → resume continues context.
//   3. The on-disk transcript at
//      ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl carries the turn
//      history we could parse to render history.
//
// Usage:
//   node resume.mjs first  <out1.jsonl> <session-id>   # establish codeword
//   node resume.mjs resume <out2.jsonl> <session-id>   # recall via --resume
//
// Run from a THROWAWAY temp dir, never the repo. Subscription auth only.
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { argv, env } from "node:process";
import { randomUUID } from "node:crypto";

const mode = argv[2]; // "first" | "resume"
const outPath = argv[3] ?? `resume-${mode}-out.jsonl`;
const sessionId = argv[4];
if (!["first", "resume"].includes(mode) || !sessionId) {
  console.error("usage: node resume.mjs first|resume <out.jsonl> <session-id>");
  process.exit(2);
}

const out = createWriteStream(outPath, { flags: "w" });
const PROMPT =
  mode === "first"
    ? "Remember this codeword: BANANA42. Just acknowledge with 'OK'."
    : "What was the codeword I told you earlier? Reply with just the codeword.";

function banner(s) {
  process.stdout.write(s);
}
function record(obj) {
  out.write(JSON.stringify({ _dir: "out", ...obj }) + "\n");
}

const childEnv = { ...env };
delete childEnv.ANTHROPIC_API_KEY;

// First run: brand-new session with a FIXED id. Resume run: --resume <id>.
const baseArgs = [
  "--input-format",
  "stream-json",
  "--output-format",
  "stream-json",
  "--verbose",
  "--include-partial-messages",
  "--permission-mode",
  "default",
];
const args = mode === "first" ? [...baseArgs, "--session-id", sessionId] : [...baseArgs, "--resume", sessionId];

banner(`>>> mode=${mode} sessionId=${sessionId}\n>>> claude ${args.join(" ")}\n`);

const child = spawn("claude", args, {
  cwd: process.cwd(),
  env: childEnv,
  stdio: ["pipe", "pipe", "pipe"],
});

const KILL_AFTER_MS = 120_000;
const killTimer = setTimeout(() => {
  banner(`\n>>> SAFETY TIMEOUT — killing child\n`);
  try {
    child.kill("SIGKILL");
  } catch {}
}, KILL_AFTER_MS);

function write(obj) {
  record(obj);
  child.stdin.write(JSON.stringify(obj) + "\n");
}

let buf = "";
let userSent = false;
let gotResult = false;

function sendUser() {
  if (userSent) return;
  userSent = true;
  const userMsg = { type: "user", message: { role: "user", content: [{ type: "text", text: PROMPT }] } };
  banner(`\n>>> SENDING user message:\n${JSON.stringify(userMsg)}\n`);
  write(userMsg);
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

    if (msg.type === "system" && msg.subtype === "init") {
      banner(`\n>>> system/init session_id=${msg.session_id}\n`);
    }
    // Reply to our initialize handshake → send the user message.
    if (msg.type === "control_response" && !userSent) {
      sendUser();
      continue;
    }
    if (msg.type === "result") {
      gotResult = true;
      banner(`\n>>> RESULT subtype=${msg.subtype} session_id=${msg.session_id} result=${JSON.stringify(msg.result)}\n`);
      clearTimeout(killTimer);
      // Close stdin so the process EXITS (proves process death for resume).
      try {
        child.stdin.end();
      } catch {}
    }
  }
});

child.stderr.on("data", (c) => process.stderr.write(c));
child.on("exit", (code, signal) => {
  clearTimeout(killTimer);
  out.end();
  process.stderr.write(`\n[child exit code=${code} signal=${signal} gotResult=${gotResult}]\n`);
  process.exitCode = 0;
});

// Send the initialize control handshake (no hooks needed here).
const initReq = {
  type: "control_request",
  request_id: `init-${randomUUID()}`,
  request: { subtype: "initialize" },
};
banner(`>>> SENDING initialize control_request:\n${JSON.stringify(initReq)}\n`);
write(initReq);
