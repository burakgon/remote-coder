// Client-side mirror of the Plan 3 server contract (packages/server/src/replay-buffer.ts,
// session-hub.ts, fs-service.ts, claude-process.ts and @remote-coder/protocol). Kept as a
// standalone type module so the browser bundle never imports the Node server package.

export type ServerFrameKind = "event" | "permission" | "question" | "result" | "diagnostic" | "exit" | "attachment";

export interface ServerFrame {
  seq: number;
  kind: ServerFrameKind;
  payload: unknown;
}

export interface SessionMeta {
  id: string;
  cwd: string;
  model?: string;
  effort?: string;
  dangerouslySkip: boolean;
  status: "running" | "dormant" | "errored" | "stopped";
  createdAt: number;
  permissionMode?: string;
}

/**
 * A past Claude conversation that can be resumed (server-side mirror: packages/server/src/transcript.ts,
 * GET /resumable). One row per on-disk transcript, recent-first. `summary` is the first user message
 * (the eye-level line); `lastActivity` is the transcript file mtime (ms).
 */
export interface ResumableSession {
  sessionId: string;
  cwd?: string;
  gitBranch?: string;
  summary: string;
  lastActivity: number;
  messageCount: number;
}

export interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isGitRepo: boolean;
  gitBranch?: string;
}

export interface DirListing {
  path: string;
  parent?: string;
  entries: DirEntry[];
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

export interface PermissionPayload {
  requestId: string;
  kind: "hook_callback" | "can_use_tool";
  toolName?: string;
  toolInput?: unknown;
  toolUseId?: string;
}

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface QuestionSpec {
  question: string;
  header?: string;
  multiSelect: boolean;
  options: QuestionOption[];
}

export interface QuestionPayload {
  requestId: string;
  toolUseId?: string;
  toolInput: unknown;
  questions: QuestionSpec[];
}

export interface ResultPayload {
  type: "result";
  subtype?: string;
  isError?: boolean;
  result?: string;
  sessionId?: string;
  totalCostUsd?: number;
  permissionDenials?: unknown[];
  raw: unknown;
}

export interface DiagnosticPayload {
  source: "stderr" | "parser";
  message: string;
}

/**
 * Claude sent a file/image to the chat (server-side mirror: packages/server/src/fs-service.ts).
 * Carries only the PATH — the web fetches the bytes via /fs/download (the `downloadUrl` builder) so a
 * large file never bloats the WS frame. `isImage` decides inline-image vs download-chip rendering.
 */
export interface AttachmentPayload {
  id: string;
  path: string;
  name: string;
  caption?: string;
  isImage: boolean;
}

export type OutboundFrame =
  | {
      type: "user";
      content?: string;
      blocks?: ContentBlock[];
      text?: string;
      images?: { mediaType: string; dataBase64: string }[];
    }
  | { type: "permission"; requestId: string; decision: "allow" | "deny"; reason?: string }
  | { type: "answer"; requestId: string; toolInput: unknown; answers: Record<string, string | string[]> }
  | { type: "settings"; model?: string; maxThinkingTokens?: number; effort?: string; permissionMode?: string };
