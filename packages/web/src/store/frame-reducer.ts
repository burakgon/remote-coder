import type {
  AttachmentPayload,
  ContentBlock,
  DiagnosticPayload,
  PermissionPayload,
  QuestionPayload,
  ResultPayload,
  ServerFrame,
} from "../types/server";
import type { LiveWireState } from "../ui/LiveWire";

export type TurnItem =
  | { kind: "assistant-text"; text: string }
  | { kind: "tool-use"; id: string; name: string; input: unknown }
  | { kind: "tool-result"; toolUseId: string; content: unknown }
  | { kind: "user"; blocks: ContentBlock[] }
  | { kind: "result"; result?: string; isError?: boolean; totalCostUsd?: number; stopped?: boolean }
  | { kind: "attachment"; id: string; path: string; name: string; caption?: string; isImage: boolean };

export interface SessionView {
  liveText: string;
  thinkingText: string;
  turns: TurnItem[];
  pendingPermission?: PermissionPayload;
  pendingQuestion?: QuestionPayload;
  lastResult?: ResultPayload;
  diagnostics: DiagnosticPayload[];
  wireState: LiveWireState;
  lastSeq: number;
  /**
   * UUIDs of `user` text turns we've already rendered from a `user` event. Resume replays the
   * transcript's user lines as `user` events carrying the typed text; this set lets a second
   * delivery of the SAME line (e.g. a transcript frame overlapping an optimistic send, or a
   * duplicate replay) be a no-op so a user bubble is never drawn twice.
   */
  seenUserUuids: Set<string>;
}

export function emptyView(): SessionView {
  return {
    liveText: "",
    thinkingText: "",
    turns: [],
    diagnostics: [],
    wireState: "idle",
    lastSeq: 0,
    seenUserUuids: new Set(),
  };
}

interface DeltaEvent {
  type?: string;
  index?: number;
  delta?: { type?: string; text?: string; thinking?: string; partial_json?: string };
}
interface AssistantMsg {
  message?: { content?: Array<{ type?: string; text?: string; id?: string; name?: string; input?: unknown }> };
}
interface UserMsg {
  message?: { content?: string | Array<{ type?: string; tool_use_id?: string; content?: unknown; text?: string }> };
  /** Present on transcript-replayed lines (parseLine passes the raw line through); used to dedupe. */
  uuid?: string;
  raw?: { uuid?: string };
}

/**
 * Pure: fold one ServerFrame into the per-session view. Never throws on unknown shapes.
 *
 * Delta-replay dedup: a reconnect requests `?since=<lastSeq>` and the server replays only
 * `seq > since`, but to be defensive against any overlap we drop any frame whose `seq` is
 * at or below the last applied `seq`. This guarantees streamed text is never double-counted
 * and a `permission`/`result` is never re-fired on reconnect.
 */
export function reduceFrame(view: SessionView, frame: ServerFrame): SessionView {
  // Idempotent on replay: a frame we've already applied (or an out-of-order duplicate) is a no-op.
  if (frame.seq <= view.lastSeq) return view;

  const next: SessionView = { ...view, lastSeq: Math.max(view.lastSeq, frame.seq) };

  if (frame.kind === "question") {
    next.pendingQuestion = frame.payload as QuestionPayload;
    next.wireState = "awaiting";
    return next;
  }
  if (frame.kind === "permission") {
    next.pendingPermission = frame.payload as PermissionPayload;
    next.wireState = "awaiting";
    return next;
  }
  if (frame.kind === "diagnostic") {
    next.diagnostics = [...view.diagnostics, frame.payload as DiagnosticPayload];
    return next;
  }
  if (frame.kind === "result") {
    const r = frame.payload as ResultPayload;
    // A user-initiated STOP (interrupt) ends the turn with terminal_reason "aborted_streaming" (and
    // subtype "error_during_execution"). That is NOT a real error — render it as a calm "Stopped"
    // marker and return the wire to idle (so the user can type the next message), never the red error.
    const stopped = r.terminalReason === "aborted_streaming" || r.subtype === "error_during_execution";
    next.lastResult = r;
    next.pendingPermission = undefined;
    next.pendingQuestion = undefined;
    next.liveText = "";
    next.thinkingText = "";
    next.wireState = stopped ? "idle" : r.isError ? "error" : "success";
    next.turns = [
      ...view.turns,
      { kind: "result", result: r.result, isError: r.isError, totalCostUsd: r.totalCostUsd, stopped },
    ];
    return next;
  }
  if (frame.kind === "attachment") {
    // Claude sent a file/image to the chat — append it as its own turn so the message list renders
    // it inline (image) or as a download chip (file). Does not change the live wire state.
    const a = frame.payload as AttachmentPayload;
    next.turns = [
      ...view.turns,
      { kind: "attachment", id: a.id, path: a.path, name: a.name, caption: a.caption, isImage: a.isImage },
    ];
    return next;
  }
  if (frame.kind === "exit") {
    next.wireState = "error";
    return next;
  }

  // kind === "event": an InboundEvent
  const ev = frame.payload as { type?: string } & DeltaEvent & AssistantMsg & UserMsg;
  if (ev.type === "stream_event") {
    const inner = (ev as { event?: DeltaEvent }).event;
    if (inner?.type === "content_block_delta" && inner.delta) {
      if (inner.delta.type === "text_delta" && inner.delta.text) {
        next.liveText = view.liveText + inner.delta.text;
        next.wireState = "streaming";
      } else if (inner.delta.type === "thinking_delta" && inner.delta.thinking) {
        next.thinkingText = view.thinkingText + inner.delta.thinking;
        next.wireState = "thinking";
      }
    }
    return next;
  }
  if (ev.type === "assistant") {
    const content = ev.message?.content ?? [];
    const turns = [...view.turns];
    let sawTool = false;
    for (const block of content) {
      if (block.type === "text" && typeof block.text === "string") {
        turns.push({ kind: "assistant-text", text: block.text });
      } else if (block.type === "tool_use") {
        turns.push({ kind: "tool-use", id: String(block.id), name: String(block.name), input: block.input });
        sawTool = true;
      }
    }
    next.turns = turns;
    next.liveText = "";
    next.thinkingText = "";
    if (sawTool) next.wireState = "running-tool";
    return next;
  }
  if (ev.type === "user") {
    const userEv = ev as UserMsg;
    const content = userEv.message?.content;
    const turns = [...view.turns];

    // A user turn's text. On RESUME the replayed `user` line carries the typed message (as a plain
    // string or as `text` blocks); without surfacing it the resumed thread shows assistant replies
    // but not what the user actually asked. Live sends never arrive as a `user` text event (claude
    // doesn't echo them — that's why the optimistic appendUserMessage exists), so this only fires on
    // replay; even so we dedupe by the line's uuid to defend against any overlap with the optimistic
    // bubble or a duplicate replay, so a user message is never drawn twice.
    const textBlocks: ContentBlock[] = [];
    if (typeof content === "string") {
      if (content.length > 0) textBlocks.push({ type: "text", text: content });
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === "text" && typeof block.text === "string" && block.text.length > 0) {
          textBlocks.push({ type: "text", text: block.text });
        }
      }
    }
    const uuid = userEv.uuid ?? userEv.raw?.uuid;
    if (textBlocks.length > 0 && !(uuid !== undefined && view.seenUserUuids.has(uuid))) {
      turns.push({ kind: "user", blocks: textBlocks });
      if (uuid !== undefined) next.seenUserUuids = new Set(view.seenUserUuids).add(uuid);
    }

    // tool_result blocks render as their own turns (unchanged from the live pipeline).
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === "tool_result") {
          turns.push({ kind: "tool-result", toolUseId: String(block.tool_use_id), content: block.content });
        }
      }
    }

    next.turns = turns;
    return next;
  }
  if (ev.type === "system") {
    // init/status — no turn content; keep the view as-is (live link is alive).
    if (next.wireState === "idle") next.wireState = "thinking";
    return next;
  }
  return next;
}
