import { SessionManager } from "./session-manager.js";
import { ReplayBuffer } from "./replay-buffer.js";
import type { ServerFrame, ServerFrameKind } from "./replay-buffer.js";
import type { CreateSessionOptions } from "./session-manager.js";
import type { ClaudeProcess, PermissionEvent, QuestionEvent, DiagnosticEvent } from "./claude-process.js";
import type { AttachmentPayload } from "./fs-service.js";
import type { ContentBlock, HookPermissionDecision, InboundEvent, ResultEvent } from "@remote-coder/protocol";
import type { SessionStore } from "./session-store.js";
import type { HistoryService } from "./history-service.js";

export type SessionStatus = "running" | "dormant" | "errored" | "stopped";

/**
 * Decide whether a claude process `exit` was clean (→ dormant, resumable) or a failure (→ errored),
 * from its `{ code, signal }`. Clean = a 0 exit code, OR a graceful kill signal (SIGTERM/SIGINT/
 * SIGHUP — what our own stop() and a host shutdown send). A non-zero exit code, or a crash signal
 * (SIGKILL/SIGSEGV/SIGABRT/SIGBUS/SIGILL/SIGFPE), is a real failure. This only governs SELF-driven
 * exits; a stop we initiated (intentionalStop) bypasses this entirely.
 */
function isCleanExit(info: { code: number | null; signal: NodeJS.Signals | null }): boolean {
  if (info.signal) return info.signal === "SIGTERM" || info.signal === "SIGINT" || info.signal === "SIGHUP";
  // code === 0 → clean; non-zero → failure. A null code with no signal shouldn't happen, but treat
  // it as clean (no evidence of a crash) so a quirky-but-harmless exit doesn't flag red.
  return info.code === null || info.code === 0;
}

export interface SessionMeta {
  id: string;
  cwd: string;
  model?: string;
  effort?: string;
  dangerouslySkip: boolean;
  status: SessionStatus;
  createdAt: number;
  permissionMode?: string;
  /**
   * TRUE while a permission OR AskUserQuestion is pending for this session and the user hasn't
   * answered/cancelled it yet. Lets the UI show a "needs you" badge for sessions the client isn't
   * actively connected to. Transient (never persisted): a session rehydrated from the store at boot
   * is always `awaiting:false`. Set when the hub emits a permission/question frame; cleared on the
   * answer/cancel paths and defensively on the next `result`/turn.
   */
  awaiting: boolean;
  /**
   * Wall-clock ms of the last real conversation activity (user send OR assistant/result frame),
   * mirrored from the store's `last_activity_at` so the client can sort by real activity. Monotonic
   * across a session's life.
   */
  lastActivityAt: number;
}

export interface LiveSettings {
  model?: string;
  /** Thinking-token budget (the PWA's effort maps onto this). */
  maxThinkingTokens?: number;
  /** Optional human label for the effort the maxThinkingTokens came from, mirrored into meta.effort. */
  effort?: string;
  permissionMode?: string;
}

export type FrameListener = (frame: ServerFrame) => void;

export interface Subscription {
  unsubscribe(): void;
}

interface SessionRecord {
  meta: SessionMeta;
  buffer: ReplayBuffer;
  listeners: Set<FrameListener>;
  /**
   * SECURITY: the original `tool_input` the CLI sent with each AskUserQuestion, keyed by requestId,
   * captured when the hub emitted the "question" frame. answerQuestion uses THIS value — never a
   * client-echoed one — so a client cannot smuggle a tampered tool_input back into the CLI.
   */
  questionToolInputs: Map<string, unknown>;
  /**
   * RequestIds of permissions/questions currently awaiting a user answer for this session. `awaiting`
   * is `pending.size > 0`; tracking the set (not a bare counter) keeps it correct when several
   * prompts are open at once and one is answered. Cleared wholesale on a `result`/turn boundary.
   */
  pending: Set<string>;
  /**
   * Set TRUE by deleteSession/stopAll BEFORE the child is killed, so the `exit` handler can tell a
   * deliberate stop (→ dormant/removed, NOT an error) from a real crash. Reset on a fresh resume.
   */
  intentionalStop: boolean;
}

export interface SessionHubOptions {
  replayCapacity?: number;
  now?: () => number;
  store?: SessionStore;
  history?: HistoryService;
  /**
   * Observe every emitted frame (push-trigger seam). Invoked AFTER the WS listener fan-out so a push
   * dispatcher sees result/permission/question frames without coupling to the WS layer. Must never
   * throw (it is wrapped in a try/catch here so a push failure can't unwind the claude emit).
   */
  onFrame?: (sessionId: string, frame: ServerFrame) => void;
}

export class SessionHub {
  private readonly manager: SessionManager;
  private readonly replayCapacity: number;
  private readonly now: () => number;
  private readonly store?: SessionStore;
  private readonly history?: HistoryService;
  private readonly onFrame?: (sessionId: string, frame: ServerFrame) => void;
  private readonly records = new Map<string, SessionRecord>();
  /**
   * Per-id in-flight resume promises (mirrors transport.ts's idempotency `inFlight` map). Guards the
   * resume window: between the moment ensureLive sees the session as dormant and the moment the
   * manager registers the live process, two overlapping ensureLive(id) calls would BOTH spawn
   * `claude --resume <id>` — leaking one process and double-registering listeners. Memoizing the
   * promise per id collapses concurrent callers onto a single resume; the key is released in a
   * `finally` so a FAILED resume can be retried by a later message.
   */
  private readonly resumeInFlight = new Map<string, Promise<void>>();

  constructor(manager: SessionManager, opts: SessionHubOptions = {}) {
    this.manager = manager;
    this.replayCapacity = opts.replayCapacity ?? 200;
    this.now = opts.now ?? Date.now;
    this.store = opts.store;
    this.history = opts.history;
    this.onFrame = opts.onFrame;
  }

  async createSession(opts: CreateSessionOptions): Promise<SessionMeta> {
    const session = await this.manager.createSession(opts);
    const now = this.now();
    const meta: SessionMeta = {
      id: session.id,
      cwd: session.cwd,
      model: opts.model,
      effort: opts.effort,
      dangerouslySkip: opts.dangerouslySkip ?? false,
      status: "running",
      createdAt: now,
      permissionMode: opts.dangerouslySkip ? "bypassPermissions" : "default",
      awaiting: false,
      lastActivityAt: now,
    };
    const record: SessionRecord = {
      meta,
      buffer: new ReplayBuffer(this.replayCapacity),
      listeners: new Set(),
      questionToolInputs: new Map(),
      pending: new Set(),
      intentionalStop: false,
    };
    this.records.set(session.id, record);
    this.attach(session.process, record);
    this.persist(meta);
    return meta;
  }

  /**
   * Resume a PAST claude session (the `claude --resume` equivalent). Spawns `claude --resume <id>` in
   * `opts.cwd` registered under the SAME id, and PRE-LOADS the parsed transcript frames into that
   * session's replay buffer so a WS client connecting sees the full prior conversation; live
   * continuation then appends after it. The transcript frames seed the buffer ONLY (they are not
   * fanned out to the push seam — there is nothing new to notify about) so reconnecting clients replay
   * exactly-once history.
   *
   * Dup-history guard: a `claude --resume` in stream-json mode does NOT re-emit the prior transcript as
   * events — it emits only the synthetic warm-up pair (already suppressed in claude-process.ts) and then
   * live continuation. So injecting the parsed transcript here yields history EXACTLY ONCE.
   *
   * Idempotency: resuming an already-live id just returns its existing meta (no second spawn, no
   * re-seeded buffer).
   */
  async resumeFromTranscript(opts: {
    sessionId: string;
    cwd: string;
    model?: string;
    effort?: string;
    dangerouslySkip?: boolean;
    frames: ServerFrame[];
  }): Promise<SessionMeta> {
    const existing = this.records.get(opts.sessionId);
    if (existing && this.manager.getSession(opts.sessionId)) return existing.meta;

    const session = await this.manager.createSession({
      cwd: opts.cwd,
      model: opts.model,
      effort: opts.effort,
      dangerouslySkip: opts.dangerouslySkip,
      resumeId: opts.sessionId,
    });
    const now = this.now();
    const meta: SessionMeta = {
      id: session.id,
      cwd: session.cwd,
      model: opts.model,
      effort: opts.effort,
      dangerouslySkip: opts.dangerouslySkip ?? false,
      status: "running",
      createdAt: now,
      permissionMode: opts.dangerouslySkip ? "bypassPermissions" : "default",
      awaiting: false,
      lastActivityAt: now,
    };
    const buffer = new ReplayBuffer(this.replayCapacity);
    // Seed the buffer with the prior conversation (each push assigns a contiguous seq), so any client
    // that connects replays the full history BEFORE live continuation frames.
    for (const frame of opts.frames) buffer.push(frame.kind, frame.payload);
    const record: SessionRecord = {
      meta,
      buffer,
      listeners: new Set(),
      questionToolInputs: new Map(),
      pending: new Set(),
      intentionalStop: false,
    };
    this.records.set(session.id, record);
    this.attach(session.process, record);
    this.persist(meta);
    return meta;
  }

  /**
   * Push a frame into a session's buffer and fan it out to live subscribers + the onFrame seam.
   * The single seq/emit/replay path shared by claude-driven frames AND server-injected ones
   * (e.g. an attachment): a frame pushed here is delivered live AND buffered for reconnect.
   */
  private emitFrame(record: SessionRecord, kind: ServerFrameKind, payload: unknown): ServerFrame {
    const frame = record.buffer.push(kind, payload);
    for (const listener of record.listeners) listener(frame);
    if (this.onFrame) {
      try {
        this.onFrame(record.meta.id, frame);
      } catch {
        // a push-dispatch error must never unwind the claude process emit (spec §10)
      }
    }
    return frame;
  }

  /**
   * Inject an `attachment` frame (Claude sent a file to the chat via the mcp-send tool, relayed by
   * POST /sessions/:id/attach). Goes through the SAME seq/emit/replay-buffer path as claude frames,
   * so connected clients get it live AND it survives a WS reconnect (attachment is a critical kind).
   */
  pushAttachment(id: string, payload: AttachmentPayload): ServerFrame {
    const record = this.require(id);
    return this.emitFrame(record, "attachment", payload);
  }

  private attach(proc: ClaudeProcess, record: SessionRecord): void {
    const emit = (kind: ServerFrameKind, payload: unknown) => this.emitFrame(record, kind, payload);
    proc.on("event", (ev: InboundEvent) => {
      // Assistant activity (the CLI streams events as it works) counts as conversation activity for
      // sorting; bump lastActivityAt so a session that's actively responding sorts above an idle one.
      this.markActivity(record);
      emit("event", ev);
    });
    proc.on("permission", (perm: PermissionEvent) => {
      this.setAwaiting(record, perm.requestId, true);
      emit("permission", perm);
    });
    proc.on("question", (q: QuestionEvent) => {
      // SECURITY: remember the CLI's original tool_input for this requestId so answerQuestion
      // replays IT (not a client-echoed value) back into the CLI.
      record.questionToolInputs.set(q.requestId, q.toolInput);
      this.setAwaiting(record, q.requestId, true);
      emit("question", q);
    });
    proc.on("result", (result: ResultEvent) => {
      // A turn finished: nothing is pending anymore (defensive clear in case an answer frame was
      // dropped), and this is real conversation activity.
      this.clearAllAwaiting(record);
      this.markActivity(record);
      emit("result", result);
    });
    proc.on("diagnostic", (diag: DiagnosticEvent) => emit("diagnostic", diag));
    // CRITICAL: Node's EventEmitter throws on an "error" event with no listener.
    // ClaudeProcess.write() emits "error" on write-after-teardown, so every managed
    // process MUST have an "error" listener. Fold it into a diagnostic frame (spec §10).
    proc.on("error", (err: Error) => {
      record.meta.status = "errored";
      this.persist(record.meta);
      emit("diagnostic", { source: "parser", message: err.message } satisfies DiagnosticEvent);
    });
    proc.on("exit", (info) => {
      // A deliberate stop (deleteSession/stopAll) is being torn down separately — don't fight it by
      // flipping to errored. For a self-driven exit: a clean exit (code 0, or a kill signal from a
      // graceful stop) leaves the session DORMANT (resumable, not an error); a non-zero exit code or
      // an unexpected crash signal is a real failure → errored.
      if (!record.intentionalStop && record.meta.status !== "errored") {
        record.meta.status = isCleanExit(info) ? "dormant" : "errored";
        record.meta.awaiting = false;
        record.pending.clear();
        this.persist(record.meta);
      }
      emit("exit", info);
    });
  }

  /** Mark a request pending/answered and recompute `meta.awaiting` (true iff anything is pending). */
  private setAwaiting(record: SessionRecord, requestId: string, awaiting: boolean): void {
    if (awaiting) record.pending.add(requestId);
    else record.pending.delete(requestId);
    record.meta.awaiting = record.pending.size > 0;
  }

  /** Clear every pending prompt for a session (turn boundary / exit). */
  private clearAllAwaiting(record: SessionRecord): void {
    record.pending.clear();
    record.meta.awaiting = false;
  }

  /**
   * Bump lastActivityAt (in-memory meta + durable store) to mark real conversation activity.
   * The store write is best-effort: a killed child can flush buffered stdout events AFTER the
   * onClose hook has closed the store ("database connection is not open"), and a touch failing
   * must never unwind the process emit — the in-memory meta is the source of truth for live reads.
   */
  private markActivity(record: SessionRecord): void {
    const at = this.now();
    record.meta.lastActivityAt = at;
    try {
      this.store?.touch(record.meta.id, at);
    } catch {
      // store closed/unavailable — in-memory lastActivityAt already updated; ignore (spec §10)
    }
  }

  listSessions(): SessionMeta[] {
    return [...this.records.values()].map((r) => r.meta);
  }

  getSession(id: string): SessionMeta | undefined {
    return this.records.get(id)?.meta;
  }

  /**
   * Conversation history for a session. Live/buffered frames win; for a dormant session whose
   * buffer is empty (e.g. just rehydrated after a restart) project the on-disk jsonl transcript
   * into event-kind frames so history survives a process restart.
   */
  async getHistory(id: string): Promise<ServerFrame[]> {
    const record = this.require(id);
    const buffered = record.buffer.snapshot();
    if (buffered.length > 0 || !this.history) return buffered;
    const turns = await this.history.read(record.meta.cwd, id);
    return turns.map((t, i) => ({
      seq: i + 1,
      kind: "event" as const,
      payload: { type: t.type, message: t.message, raw: t },
    }));
  }

  /** Live subscriber count for a session (0 if unknown). Lets the WS layer assert no leak. */
  subscriberCount(id: string): number {
    return this.records.get(id)?.listeners.size ?? 0;
  }

  subscribe(id: string, listener: FrameListener, sinceSeq?: number): Subscription {
    const record = this.require(id);
    // Replay first (spec §10), then go live.
    const replay = sinceSeq === undefined ? record.buffer.snapshot() : record.buffer.since(sinceSeq);
    for (const frame of replay) listener(frame);
    record.listeners.add(listener);
    return {
      unsubscribe: () => {
        record.listeners.delete(listener);
      },
    };
  }

  async sendMessage(id: string, content: string | ContentBlock[]): Promise<void> {
    await this.ensureLive(id);
    this.manager.sendMessage(id, content);
    // User send is conversation activity: bump lastActivityAt (in-memory meta + durable store).
    const record = this.records.get(id);
    if (record) this.markActivity(record);
  }

  async answerPermission(
    id: string,
    requestId: string,
    decision: HookPermissionDecision,
    reason?: string,
  ): Promise<void> {
    await this.ensureLive(id);
    this.manager.answerPermission(id, requestId, decision, reason);
    const record = this.records.get(id);
    // A skipped/denied AskUserQuestion routes through here (the web client sends a `deny`
    // permission for "Skip"), so the remembered tool_input would otherwise leak for the session
    // lifetime — answerQuestion deletes it on the answer path, mirror that on the cancel path.
    record?.questionToolInputs.delete(requestId);
    // The prompt is answered: drop it from the pending set and recompute `awaiting`.
    if (record) this.setAwaiting(record, requestId, false);
  }

  /**
   * Answer an AskUserQuestion. SECURITY: the `_clientToolInput` argument is IGNORED — we replay the
   * tool_input the CLI originally sent for this requestId (remembered in `record.questionToolInputs`)
   * so a client cannot tamper with what goes back to the CLI. Falls back to the client value only if
   * (impossibly) no remembered input exists for the requestId.
   */
  async answerQuestion(
    id: string,
    requestId: string,
    _clientToolInput: unknown,
    answers: Record<string, string | string[]>,
  ): Promise<void> {
    await this.ensureLive(id);
    const record = this.require(id);
    const remembered = record.questionToolInputs.has(requestId)
      ? record.questionToolInputs.get(requestId)
      : _clientToolInput;
    this.manager.answerQuestion(id, requestId, remembered, answers);
    record.questionToolInputs.delete(requestId);
    // The question is answered: drop it from the pending set and recompute `awaiting`.
    this.setAwaiting(record, requestId, false);
  }

  /**
   * Apply live settings to a running session: send each provided control to the CLI and mirror the
   * change into the in-memory SessionMeta so a subsequent getSession reflects it.
   */
  async applySettings(id: string, settings: LiveSettings): Promise<SessionMeta> {
    await this.ensureLive(id);
    const record = this.require(id);
    if (settings.model !== undefined) {
      this.manager.setModel(id, settings.model);
      record.meta.model = settings.model;
    }
    if (settings.maxThinkingTokens !== undefined) {
      this.manager.setMaxThinkingTokens(id, settings.maxThinkingTokens);
      if (settings.effort !== undefined) record.meta.effort = settings.effort;
    }
    if (settings.permissionMode !== undefined) {
      this.manager.setPermissionMode(id, settings.permissionMode);
      record.meta.permissionMode = settings.permissionMode;
    }
    this.persist(record.meta);
    return record.meta;
  }

  /**
   * Close a session: stop its live `claude` process (if any), then REMOVE it from the in-memory list
   * AND the durable store. Idempotent — closing an unknown id is a no-op. The claude transcript
   * `.jsonl` is NOT touched (claude owns it; the session stays resumable via the /resume flow +
   * GET /resumable). Both the chat ✕ and the Settings "Stop session" converge here.
   */
  deleteSession(id: string): void {
    const record = this.records.get(id);
    if (!record) return; // unknown id → no-op (idempotent)
    // Mark BEFORE killing so the `exit` handler treats this as a deliberate stop, not a crash.
    record.intentionalStop = true;
    if (this.manager.getSession(id)) this.manager.stopSession(id);
    // Drop every trace from the hub + store; the transcript on disk is intentionally left alone.
    this.records.delete(id);
    this.resumeInFlight.delete(id);
    record.listeners.clear();
    record.questionToolInputs.clear();
    record.pending.clear();
    this.store?.delete(id);
  }

  /**
   * Stop a session. Now an alias for {@link deleteSession}: both the chat ✕ and the Settings
   * "Stop session" must make the session disappear from the list (stop the process AND remove the
   * record + store row), keeping the transcript resumable. A subsequent GET /sessions — even after a
   * server restart that reconstructs the hub from the store — will not include it.
   */
  stopSession(id: string): void {
    this.deleteSession(id);
  }

  /**
   * Stop every LIVE session's child `claude` for a graceful server shutdown (onClose hook) WITHOUT
   * removing the records: a deploy/restart must leave sessions DORMANT (resumable) in the store, not
   * delete them. Each live process is killed (intentionalStop, so the exit handler won't flag it
   * errored) and its meta written back as dormant so it rehydrates correctly after the restart.
   */
  stopAll(): void {
    for (const [id, record] of this.records) {
      if (this.manager.getSession(id)) {
        record.intentionalStop = true;
        this.manager.stopSession(id);
      }
      record.meta.status = "dormant";
      record.meta.awaiting = false;
      record.pending.clear();
      this.persist(record.meta);
    }
  }

  /**
   * Write the session's current meta to the durable store (no-op when no store is configured).
   * `lastActivityAt` carries the meta's own value (kept fresh by markActivity) so persisting a
   * status/settings change can't clobber the real last-activity time — `awaiting` is transient and
   * deliberately NOT persisted (a rehydrated session is always awaiting:false).
   */
  private persist(meta: SessionMeta): void {
    try {
      this.store?.upsert({
        id: meta.id,
        cwd: meta.cwd,
        model: meta.model,
        effort: meta.effort,
        dangerouslySkip: meta.dangerouslySkip,
        status: meta.status,
        createdAt: meta.createdAt,
        lastActivityAt: meta.lastActivityAt,
        permissionMode: meta.permissionMode,
      });
    } catch {
      // best-effort: an exit/error frame can land AFTER onClose closed the store; the in-memory meta
      // is authoritative for live reads and the store already holds the last good state. (spec §10)
    }
  }

  /** Rehydrate DORMANT session metas from the store at boot (no live process is spawned). */
  loadFromStore(): void {
    if (!this.store) return;
    for (const s of this.store.list()) {
      if (this.records.has(s.id)) continue;
      const meta: SessionMeta = {
        id: s.id,
        cwd: s.cwd,
        model: s.model,
        effort: s.effort,
        dangerouslySkip: s.dangerouslySkip,
        status: "dormant",
        createdAt: s.createdAt,
        permissionMode: s.permissionMode,
        // A rehydrated session has no live process and no pending prompt: never awaiting on boot.
        awaiting: false,
        lastActivityAt: s.lastActivityAt,
      };
      this.records.set(s.id, {
        meta,
        buffer: new ReplayBuffer(this.replayCapacity),
        listeners: new Set(),
        questionToolInputs: new Map(),
        pending: new Set(),
        intentionalStop: false,
      });
    }
  }

  /** Ensure a record has a LIVE process; resume a dormant/dead one in its stored cwd. */
  private async ensureLive(id: string): Promise<void> {
    const record = this.require(id);
    if (this.manager.getSession(id)) return; // already live
    // A concurrent ensureLive is already resuming this id — await ITS promise instead of spawning a
    // second `claude --resume`. NOTE: the has()-check and the set() below must stay synchronous (no
    // await between them) so two overlapping callers can never both miss and both spawn.
    const pending = this.resumeInFlight.get(id);
    if (pending) return pending;

    const resume = (async () => {
      const session = await this.manager.resumeSession(id, {
        cwd: record.meta.cwd,
        model: record.meta.model,
        effort: record.meta.effort,
        dangerouslySkip: record.meta.dangerouslySkip,
      });
      record.meta.status = "running";
      // Fresh live process: clear the deliberate-stop guard so its eventual exit is judged on its own
      // merits (clean → dormant, crash → errored), and start from a clean awaiting state.
      record.intentionalStop = false;
      this.clearAllAwaiting(record);
      this.attach(session.process, record);
      this.persist(record.meta);
    })();
    this.resumeInFlight.set(id, resume);
    try {
      await resume;
    } finally {
      // Release the key whether the resume succeeded or FAILED — a failed resume must not wedge the
      // session forever; a later message can retry rather than awaiting a settled-rejected promise.
      this.resumeInFlight.delete(id);
    }
  }

  private require(id: string): SessionRecord {
    const record = this.records.get(id);
    if (!record) throw new Error(`unknown session: ${id}`);
    return record;
  }
}
