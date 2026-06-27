/**
 * QA replay harness (shared by the triage script and the committed regression test).
 *
 * Faithfully reconstructs BOTH production render paths for a captured scenario and folds them through
 * the REAL web frame-reducer:
 *   - LIVE:   raw CLI stdout lines → parseLine → (mirror ClaudeProcess.handleLine dispatch) →
 *             ServerFrames (event / result / question / permission) → reduceFrame
 *   - REOPEN: transcript .jsonl → parseTranscript + transcriptToFrames (the real server fns) → reduceFrame
 *
 * Then it walks the resulting SessionView (incl. subagent threads) collecting everything a user would
 * actually SEE, using the real render helpers (planRender / parseToolResult / summarizeToolInput /
 * subagentResultText), and reports leaks (raw XML tags), "[object Object]", dropped content, and
 * live-vs-reopen parity gaps. Pure — no process spawn; safe to import from a vitest test.
 */
import {
  parseLine,
  classifyPermissionRequest,
  classifyQuestionRequest,
  type ControlRequestEvent,
} from "@remote-coder/protocol";
import { parseTranscript, transcriptToFrames } from "../src/transcript";
import {
  reduceFrame,
  emptyView,
  subagentResultText,
  type SessionView,
  type TurnItem,
} from "../../web/src/store/frame-reducer";
import { planRender, parseToolResult, summarizeToolInput } from "../../web/src/chat/tool-cluster";
import type { ServerFrame, ServerFrameKind } from "../../web/src/types/server";

/** Raw-XML envelope tags that must NEVER reach a rendered USER/system/command turn (the user's bug). */
export const LEAK_RE =
  /<\/?(?:local-command-(?:stdout|caveat)|command-(?:name|args|message)|system-reminder|task-notification)\b/;

/** A long base64 run — a leaked image blob dumped as text (BUG-2). Real prose never looks like this. */
export const BLOB_RE = /[A-Za-z0-9+/]{200,}={0,2}/;

export interface RenderedPiece {
  /** Which turn kind / thread surface produced this text. */
  kind: string;
  /** Default-visible (true) vs only-on-expand (false, e.g. a tool-result raw body). */
  visible: boolean;
  text: string;
}

/** Mirror ClaudeProcess.handleLine: every event becomes an "event" frame; result/question/permission
 *  additionally become their dedicated frames. `_dir:"out"` lines are client→CLI and never emitted. */
export function liveFramesFromLines(lines: string[]): ServerFrame[] {
  const frames: ServerFrame[] = [];
  let seq = 0;
  const push = (kind: ServerFrameKind, payload: unknown) => frames.push({ seq: ++seq, kind, payload });
  for (const raw of lines) {
    if (!raw.trim()) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (obj._dir === "out") continue;
    delete obj._dir;
    const ev = parseLine(JSON.stringify(obj));
    if (!ev) continue;
    push("event", ev);
    if (ev.type === "control_request") {
      const q = classifyQuestionRequest(ev as ControlRequestEvent);
      if (q) {
        push("question", {
          requestId: q.requestId,
          toolUseId: q.toolUseId,
          toolInput: q.toolInput,
          questions: q.questions,
        });
        continue;
      }
      const p = classifyPermissionRequest(ev as ControlRequestEvent);
      if (p) {
        push("permission", {
          requestId: (ev as ControlRequestEvent).requestId,
          kind: p.kind,
          toolName: p.toolName,
          toolInput: p.toolInput,
          toolUseId: p.toolUseId,
        });
      }
      continue;
    }
    if (ev.type === "result") push("result", ev);
  }
  return frames;
}

export function reopenFrames(transcriptJsonl: string): ServerFrame[] {
  return transcriptToFrames(parseTranscript(transcriptJsonl));
}

export function foldFrames(frames: ServerFrame[]): SessionView {
  let view = emptyView();
  for (const f of frames) view = reduceFrame(view, f);
  return view;
}

function textOfBlocks(blocks: unknown): string {
  if (!Array.isArray(blocks)) return "";
  return blocks
    .filter((b) => b && typeof b === "object" && (b as { type?: string }).type === "text")
    .map((b) => (b as { text?: string }).text ?? "")
    .join("\n");
}

/** Everything the user can see for one flat turn list — using the SAME render helpers the UI uses. */
function collectTurns(turns: TurnItem[], prefix: string, out: RenderedPiece[]): void {
  const nodes = planRender(turns);
  for (const node of nodes) {
    if (node.kind === "cluster") {
      for (const step of node.steps) {
        out.push({
          kind: `${prefix}tool-use:${step.use.name}`,
          visible: true,
          text: `${step.use.name} ${summarizeToolInput(step.use.input)}`,
        });
        if (step.result) {
          const pr = parseToolResult(step.result.content);
          out.push({ kind: `${prefix}tool-result.summary`, visible: true, text: pr.summary });
          out.push({ kind: `${prefix}tool-result.text`, visible: false, text: pr.text });
          out.push({ kind: `${prefix}tool-result.raw`, visible: false, text: pr.raw });
        }
      }
      continue;
    }
    if (node.kind === "subagent") {
      out.push({ kind: `${prefix}subagent-ref`, visible: true, text: node.id });
      continue;
    }
    const t = node.item;
    switch (t.kind) {
      case "user":
        out.push({ kind: `${prefix}user`, visible: true, text: textOfBlocks(t.blocks) });
        break;
      case "assistant-text":
        out.push({ kind: `${prefix}assistant-text`, visible: true, text: t.text });
        break;
      case "system-note":
        out.push({ kind: `${prefix}system-note`, visible: true, text: t.text });
        break;
      case "command":
        out.push({ kind: `${prefix}command`, visible: true, text: `${t.command ?? ""} ${t.output ?? ""}`.trim() });
        break;
      case "result":
        out.push({ kind: `${prefix}result`, visible: true, text: t.result ?? "" });
        break;
      case "attachment":
        out.push({ kind: `${prefix}attachment`, visible: true, text: `${t.name} ${t.caption ?? ""}`.trim() });
        break;
      case "asked-question":
        out.push({
          kind: `${prefix}asked-question`,
          visible: true,
          text: `${t.questions.map((q) => `${q.header ?? ""} ${q.question}`).join(" | ")} ${t.answer ?? ""}`.trim(),
        });
        break;
      case "tool-result":
        out.push({ kind: `${prefix}tool-result.summary`, visible: true, text: parseToolResult(t.content).summary });
        break;
      case "rewound":
        out.push({ kind: `${prefix}rewound`, visible: true, text: t.error ?? t.mode });
        break;
    }
  }
}

/** Collect renderable text across the main thread AND every subagent thread. */
export function collectRenderable(view: SessionView): RenderedPiece[] {
  const out: RenderedPiece[] = [];
  collectTurns(view.turns, "", out);
  for (const id of view.subagentOrder) {
    const th = view.subagents[id];
    if (!th) continue;
    if (th.prompt) out.push({ kind: "sub.prompt", visible: true, text: th.prompt });
    if (th.description) out.push({ kind: "sub.description", visible: true, text: th.description });
    if (th.summary) out.push({ kind: "sub.summary", visible: true, text: th.summary });
    if (th.activity) out.push({ kind: "sub.activity", visible: true, text: th.activity });
    collectTurns(th.turns, "sub.", out);
    if (th.result) out.push({ kind: "sub.result", visible: true, text: subagentResultText(th.result.content) });
  }
  // Live-only transient surfaces (also rendered).
  if (view.liveText) out.push({ kind: "liveText", visible: true, text: view.liveText });
  if (view.thinkingText) out.push({ kind: "thinkingText", visible: true, text: view.thinkingText });
  return out;
}

export interface Issue {
  fixture: string;
  path: "live" | "reopen" | "parity";
  severity: "high" | "med" | "low";
  kind: string;
  detail: string;
}

/** A compact signature of the turn list for parity comparison (kind + short text), excluding the
 *  live-only `result` turns the transcript can't carry. */
export function turnSignature(view: SessionView): string[] {
  const sig: string[] = [];
  for (const t of view.turns) {
    if (t.kind === "result") continue; // transcript carries no result lines → expected divergence
    if (t.kind === "user") sig.push(`user:${textOfBlocks(t.blocks).slice(0, 40)}`);
    else if (t.kind === "assistant-text") sig.push(`asst:${t.text.slice(0, 40)}`);
    else if (t.kind === "system-note") sig.push(`note:${t.text.slice(0, 40)}`);
    else if (t.kind === "command") sig.push(`cmd:${(t.command ?? "") + "/" + (t.output ?? "")}`.slice(0, 40));
    else if (t.kind === "tool-use") sig.push(`use:${t.name}`);
    else if (t.kind === "tool-result") sig.push(`res`);
    else if (t.kind === "subagent-ref") sig.push(`sub`);
    else if (t.kind === "asked-question") sig.push(`ask`);
    else if (t.kind === "attachment") sig.push(`att:${t.name}`);
  }
  return sig;
}

/** Run all checks for one fixture given its live lines + transcript text. */
export function analyzeFixture(
  fixture: string,
  liveLines: string[],
  transcriptJsonl: string,
): {
  issues: Issue[];
  live: SessionView;
  reopen: SessionView;
} {
  const issues: Issue[] = [];
  const live = foldFrames(liveFramesFromLines(liveLines));
  const reopen = foldFrames(reopenFrames(transcriptJsonl));

  for (const [path, view] of [
    ["live", live],
    ["reopen", reopen],
  ] as const) {
    const pieces = collectRenderable(view);
    for (const p of pieces) {
      // Raw-XML envelope leak. High severity in user-typed/synthetic surfaces; the model could legitimately
      // discuss these tags in assistant prose or echo them in tool output, so flag those lower.
      if (LEAK_RE.test(p.text)) {
        const userSurface = /(?:^|\.)(user|system-note|command)$/.test(p.kind);
        issues.push({
          fixture,
          path,
          severity: userSurface ? "high" : "low",
          kind: `leak:${p.kind}`,
          detail: p.text.replace(/\s+/g, " ").slice(0, 160),
        });
      }
      if (p.text.includes("[object Object]")) {
        issues.push({ fixture, path, severity: "high", kind: `objectObject:${p.kind}`, detail: p.text.slice(0, 120) });
      }
      if (BLOB_RE.test(p.text)) {
        issues.push({ fixture, path, severity: "high", kind: `base64Blob:${p.kind}`, detail: `len=${p.text.length}` });
      }
    }
  }

  // Parity: the non-result turn signatures should match between live and reopen.
  const ls = turnSignature(live);
  const rs = turnSignature(reopen);
  if (JSON.stringify(ls) !== JSON.stringify(rs)) {
    issues.push({
      fixture,
      path: "parity",
      severity: "med",
      kind: "turn-parity",
      detail: `live(${ls.length}) vs reopen(${rs.length})\n  LIVE  : ${JSON.stringify(ls)}\n  REOPEN: ${JSON.stringify(rs)}`,
    });
  }

  return { issues, live, reopen };
}
