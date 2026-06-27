// QA capture battery for remote-coder.
//
// Defines a comprehensive set of scenarios that exercise EVERY output type the
// claude CLI can emit, drives each via capture.mjs (faithful production args),
// and copies the resulting transcript next to the live capture so BOTH formats
// (live stream-json + reopen transcript) can be replayed through the real
// pipeline. Idempotent: re-running re-captures. Bounded concurrency to be gentle
// on rate limits.
//
// Usage:  node qa-battery.mjs [onlyId1,onlyId2,...]
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, copyFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CAPTURE = join(SCRIPT_DIR, "capture.mjs");
const BASE = "/tmp/rc-qa";
const CAPS = join(BASE, "caps");
const PROJECTS = join(homedir(), ".claude", "projects");
mkdirSync(CAPS, { recursive: true });

// A minimal valid 1x1 red PNG (so Read returns a real image content block).
const PNG_1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const scenarios = [
  {
    id: "text-markdown",
    prompts: [
      "Output ONLY this as markdown, nothing else: a level-2 heading 'Demo', a bulleted list of three items, a numbered list of two items, a line with **bold**, *italic* and `inline code`, a blockquote, a fenced python code block that prints hello, and a 2-column 2-row markdown table.",
    ],
  },
  { id: "bash-ok", prompts: ["Run the Bash tool once with command: printf 'line1\\nline2\\n' && ls -a"] },
  {
    id: "bash-error",
    prompts: [
      "Run the Bash tool once with command: cat /no/such/file_xyz_qa . It will fail; just run it a single time and report the error.",
    ],
  },
  { id: "bash-long", prompts: ["Run the Bash tool once with command: seq 1 150"] },
  {
    id: "write-read-edit",
    prompts: [
      "Use the Write tool to create notes.txt containing exactly two lines: 'hello world' then 'second line'.",
      "Use the Read tool to read notes.txt and show it.",
      "Use the Edit tool to change the word 'hello' to 'goodbye' in notes.txt.",
    ],
  },
  {
    id: "grep-glob",
    setup: (dir) => {
      writeFileSync(join(dir, "a.txt"), "this has a needle in it\nanother line\n");
      writeFileSync(join(dir, "b.txt"), "no match here\n");
      writeFileSync(join(dir, "c.md"), "needle in markdown\n");
    },
    prompts: [
      "Use the Grep tool to search for the word 'needle' in the current directory.",
      "Use the Glob tool to find all *.txt files in the current directory.",
    ],
  },
  {
    id: "todowrite",
    prompts: [
      "Use the TodoWrite tool to create a todo list with three items: 'design', 'build', 'test'. Mark 'design' as in_progress and the other two as pending. Then stop without doing anything else.",
    ],
  },
  {
    id: "parallel-tools",
    prompts: [
      "In a SINGLE assistant message, call the Bash tool three times in parallel: echo aaa ; and echo bbb ; and echo ccc (three separate Bash tool calls at once).",
    ],
  },
  {
    id: "thinking",
    maxThinkingTokens: 6000,
    prompts: ["Think step by step about whether 17 is a prime number, then give a one-line answer."],
  },
  {
    id: "subagent",
    prompts: [
      "Use the Task tool to launch a general-purpose subagent whose entire prompt is: 'Reply with exactly the word PONG and nothing else.' Then tell me what the subagent replied.",
    ],
    killAfterMs: 240000,
  },
  {
    id: "compact",
    prompts: [
      "What is the capital of France? Answer in one word.",
      "Now what is the capital of Japan? Answer in one word.",
      "/compact",
    ],
    killAfterMs: 240000,
  },
  {
    id: "read-image",
    setup: (dir) => writeFileSync(join(dir, "pic.png"), Buffer.from(PNG_1x1, "base64")),
    prompts: ["Use the Read tool to read the file pic.png ."],
  },
  { id: "unicode", prompts: ["Reply with EXACTLY this line and nothing else: Café 日本語 — 🎉🚀 — Ω≈ç√∫"] },
  {
    id: "permission-deny",
    permission: "deny",
    prompts: ["Use the Write tool to create blocked.txt containing 'x'. (It may be denied; just attempt it once.)"],
  },
  {
    id: "websearch",
    prompts: ["Use the WebSearch tool to search for 'Anthropic Claude' and summarize the top result in one sentence."],
    killAfterMs: 240000,
  },
];

function runOne(sc) {
  return new Promise((resolve) => {
    const dir = join(BASE, sc.id);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    if (sc.setup) sc.setup(dir);
    const sessionId = randomUUID();
    const livePath = join(CAPS, `${sc.id}.live.jsonl`);
    const cfgPath = join(CAPS, `${sc.id}.cfg.json`);
    writeFileSync(
      cfgPath,
      JSON.stringify({
        out: livePath,
        sessionId,
        prompts: sc.prompts,
        permission: sc.permission ?? "allow",
        ...(sc.maxThinkingTokens ? { maxThinkingTokens: sc.maxThinkingTokens } : {}),
        ...(sc.model ? { model: sc.model } : {}),
        killAfterMs: sc.killAfterMs ?? 180000,
      }),
    );
    process.stderr.write(`\n=== START ${sc.id} (session ${sessionId}) ===\n`);
    const child = spawn("node", [CAPTURE, cfgPath], { cwd: dir, stdio: ["ignore", "ignore", "inherit"] });
    child.on("exit", () => {
      // Locate + copy the transcript (project dir encodes cwd; just glob by sessionId).
      let copied = false;
      try {
        for (const proj of readdirSync(PROJECTS)) {
          const cand = join(PROJECTS, proj, `${sessionId}.jsonl`);
          if (existsSync(cand)) {
            copyFileSync(cand, join(CAPS, `${sc.id}.transcript.jsonl`));
            copied = true;
            break;
          }
        }
      } catch {}
      process.stderr.write(`=== DONE ${sc.id} (transcript ${copied ? "copied" : "MISSING"}) ===\n`);
      resolve({ id: sc.id, sessionId, copied });
    });
  });
}

async function main() {
  const only = (process.argv[2] ?? "").split(",").filter(Boolean);
  const list = only.length ? scenarios.filter((s) => only.includes(s.id)) : scenarios;
  const CONCURRENCY = 3;
  const results = [];
  let idx = 0;
  async function worker() {
    while (idx < list.length) {
      const sc = list[idx++];
      results.push(await runOne(sc));
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker));
  process.stderr.write(`\n=== BATTERY COMPLETE ===\n`);
  for (const r of results) process.stderr.write(`${r.copied ? "OK " : "?? "}${r.id}\n`);
}
main();
