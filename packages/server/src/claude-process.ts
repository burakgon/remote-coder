import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  parseLine,
  serializeInitialize,
  serializeUserMessage,
  serializeHookPermissionResponse,
  serializeCanUseToolResponse,
  classifyPermissionRequest,
  ProtocolParseError,
} from "@remote-coder/protocol";
import type {
  InboundEvent,
  ResultEvent,
  ControlRequestEvent,
  ContentBlock,
  HookPermissionDecision,
  CanUseToolResult,
} from "@remote-coder/protocol";
import { buildClaudeArgs } from "./config.js";

export interface ClaudeProcessOptions {
  claudeBin: string;
  cwd: string;
  sessionId: string;
  model?: string;
  effort?: string;
  addDirs?: string[];
  dangerouslySkip?: boolean;
  /** Milliseconds to wait for the init control_response before rejecting start(). Default 30000. */
  startTimeoutMs?: number;
  /** Base environment to spawn with. ANTHROPIC_API_KEY is always deleted from a copy. Default process.env. */
  env?: NodeJS.ProcessEnv;
}

export interface PermissionEvent {
  requestId: string;
  kind: "hook_callback" | "can_use_tool";
  toolName?: string;
  toolInput?: unknown;
  toolUseId?: string;
}

export class ClaudeProcess extends EventEmitter {
  readonly sessionId: string;
  private readonly opts: ClaudeProcessOptions;
  private child?: ChildProcessWithoutNullStreams;
  private stdoutBuffer = "";
  private started = false;
  private initRequestId?: string;
  private spawnPrefixArgs: string[] = [];

  constructor(opts: ClaudeProcessOptions) {
    super();
    this.opts = opts;
    this.sessionId = opts.sessionId;
  }

  /** TEST ONLY: extra argv inserted before the claude args (used to run the mock script via node). */
  setSpawnPrefixArgsForTest(args: string[]): void {
    this.spawnPrefixArgs = args;
  }

  /** TEST ONLY: push a raw stdout line through the same path the child uses. */
  ingestLineForTest(line: string): void {
    this.handleLine(line);
  }

  start(): Promise<void> {
    if (this.started) throw new Error("ClaudeProcess already started");
    this.started = true;

    const claudeArgs = buildClaudeArgs({
      sessionId: this.opts.sessionId,
      model: this.opts.model,
      effort: this.opts.effort,
      addDirs: this.opts.addDirs,
      dangerouslySkip: this.opts.dangerouslySkip,
    });
    const args = [...this.spawnPrefixArgs, ...claudeArgs];

    // Subscription auth only: never pass an API key to the child.
    const env: NodeJS.ProcessEnv = { ...(this.opts.env ?? process.env) };
    delete env.ANTHROPIC_API_KEY;

    const child = spawn(this.opts.claudeBin, args, {
      cwd: this.opts.cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;
    this.child = child;

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.onStdoutChunk(chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", () => { /* diagnostics surfaced in a later plan; ignore here */ });
    child.on("error", (err) => this.emit("error", err));
    child.on("exit", (code, signal) => this.emit("exit", { code, signal }));

    const timeoutMs = this.opts.startTimeoutMs ?? 30000;

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        this.stop();
        reject(new Error(`claude did not respond to initialize within ${timeoutMs}ms`));
      }, timeoutMs);

      const onEvent = (ev: InboundEvent) => {
        if (ev.type === "control_response" && ev.requestId === this.initRequestId) {
          cleanup();
          resolve();
        }
      };
      const onEarlyExit = () => {
        cleanup();
        reject(new Error("claude exited before completing the initialize handshake"));
      };
      const onEarlyError = (err: Error) => {
        cleanup();
        reject(err);
      };
      const cleanup = () => {
        clearTimeout(timer);
        this.off("event", onEvent);
        this.off("exit", onEarlyExit);
        this.off("error", onEarlyError);
      };
      this.on("event", onEvent);
      this.once("exit", onEarlyExit);
      this.once("error", onEarlyError);

      // Send the initialize handshake (registers the PreToolUse hook).
      this.initRequestId = `init-${this.opts.sessionId}`;
      this.write(serializeInitialize({ requestId: this.initRequestId }));
    });
  }

  sendUserMessage(content: string | ContentBlock[]): void {
    this.write(serializeUserMessage(content));
  }

  answerPermission(requestId: string, decision: HookPermissionDecision, reason?: string): void {
    this.write(serializeHookPermissionResponse(requestId, decision, reason));
  }

  answerCanUseTool(requestId: string, result: CanUseToolResult): void {
    this.write(serializeCanUseToolResponse(requestId, result));
  }

  stop(): void {
    if (this.child && !this.child.killed) this.child.kill();
  }

  private write(line: string): void {
    this.child?.stdin.write(line + "\n");
  }

  private onStdoutChunk(chunk: string): void {
    this.stdoutBuffer += chunk;
    let nl: number;
    while ((nl = this.stdoutBuffer.indexOf("\n")) !== -1) {
      const line = this.stdoutBuffer.slice(0, nl);
      this.stdoutBuffer = this.stdoutBuffer.slice(nl + 1);
      this.handleLine(line);
    }
  }

  private handleLine(line: string): void {
    let ev: InboundEvent | null;
    try {
      ev = parseLine(line);
    } catch (err) {
      if (err instanceof ProtocolParseError) {
        // Malformed line: log + skip, never crash (spec §10).
        console.warn(`[claude-process ${this.sessionId}] skipping malformed line: ${err.message}`);
        return;
      }
      throw err;
    }
    if (!ev) return;

    this.emit("event", ev);

    if (ev.type === "control_request") {
      const info = classifyPermissionRequest(ev as ControlRequestEvent);
      if (info) {
        const perm: PermissionEvent = {
          requestId: (ev as ControlRequestEvent).requestId,
          kind: info.kind,
          toolName: info.toolName,
          toolInput: info.toolInput,
          toolUseId: info.toolUseId,
        };
        this.emit("permission", perm);
      }
      return;
    }

    if (ev.type === "result") {
      this.emit("result", ev as ResultEvent);
      // Lifecycle: on result, close stdin so the child exits.
      this.child?.stdin.end();
    }
  }
}

// Typed event overloads.
export interface ClaudeProcess {
  on(event: "event", listener: (ev: InboundEvent) => void): this;
  on(event: "permission", listener: (perm: PermissionEvent) => void): this;
  on(event: "result", listener: (result: ResultEvent) => void): this;
  on(event: "exit", listener: (info: { code: number | null; signal: NodeJS.Signals | null }) => void): this;
  on(event: "error", listener: (err: Error) => void): this;
  once(event: "event", listener: (ev: InboundEvent) => void): this;
  once(event: "permission", listener: (perm: PermissionEvent) => void): this;
  once(event: "result", listener: (result: ResultEvent) => void): this;
  once(event: "exit", listener: (info: { code: number | null; signal: NodeJS.Signals | null }) => void): this;
  once(event: "error", listener: (err: Error) => void): this;
  emit(event: "event", ev: InboundEvent): boolean;
  emit(event: "permission", perm: PermissionEvent): boolean;
  emit(event: "result", result: ResultEvent): boolean;
  emit(event: "exit", info: { code: number | null; signal: NodeJS.Signals | null }): boolean;
  emit(event: "error", err: Error): boolean;
}
