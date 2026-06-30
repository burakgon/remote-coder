// packages/server/src/terminal-process.ts
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

export interface IPty {
  onData(cb: (d: string) => void): void;
  onExit(cb: (e: { exitCode: number }) => void): void;
  write(d: string): void;
  resize(c: number, r: number): void;
  kill(sig?: string): void;
}

export type PtySpawn = (
  file: string,
  args: string[],
  opts: { name: string; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv },
) => IPty;

export interface TerminalProcessOptions {
  sessionId: string;
  cwd: string;
  claudeBin: string;
  claudeArgs?: string[];
  tmuxBin?: string;
  cols?: number;
  rows?: number;
  env?: NodeJS.ProcessEnv;
  /** Injectable PTY spawner (default loads node-pty). Tests pass a fake. */
  ptySpawn?: PtySpawn;
  /** Injectable one-shot tmux command runner (kill-session). Default spawnSync(tmuxBin). */
  runTmux?: (args: string[]) => void;
}

/** Dedicated tmux server socket — ISOLATES remote-coder's sessions from the host user's own tmux (their
 *  `tmux ls` never shows `rc-*`, a stray `kill-server` can't nuke ours, and our global options never touch
 *  theirs). Every tmux invocation must pass `-L <SOCKET>`. */
export const TMUX_SOCKET = "remote-coder";

/** The tmux session name for a remote-coder session id. Stable so attach/kill always target the same one. */
export function tmuxSessionName(id: string): string {
  return `rc-${id}`;
}

/** Server-wide tmux options that make the embedded session behave like a plain, transparent terminal rather
 *  than a visible tmux: NO status bar (it stole a row and made the TUI look shifted), instant escape-time (the
 *  500ms default mangled Esc-prefixed sequences = arrow/alt keys), mouse + focus + clipboard passthrough, and
 *  a 256-color terminfo. Set as ONE chained command BEFORE `new-session` so claude renders full-height from
 *  its first frame (no status-bar reflow). Applied on our dedicated socket, so they never affect the user's tmux. */
function tmuxConfigChain(): string[] {
  const sets: Array<[scope: string, name: string, value: string]> = [
    ["-g", "status", "off"],
    ["-s", "escape-time", "0"],
    ["-g", "mouse", "on"],
    ["-g", "focus-events", "on"],
    ["-g", "set-clipboard", "on"],
    ["-g", "default-terminal", "tmux-256color"],
    ["-g", "remain-on-exit", "on"], // claude exiting leaves a restartable [exited] pane, not a dead session
  ];
  return sets.flatMap(([scope, name, value]) => ["set-option", scope, name, value, ";"]);
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class TerminalProcess extends EventEmitter {
  readonly tmuxName: string;
  private readonly opts: TerminalProcessOptions;
  private pty?: IPty;
  private started = false;
  private readonly tmuxBin: string;
  private readonly runTmux: (args: string[]) => void;
  private readonly ptySpawn: PtySpawn;

  constructor(opts: TerminalProcessOptions) {
    super();
    this.opts = opts;
    this.tmuxName = tmuxSessionName(opts.sessionId);
    this.tmuxBin = opts.tmuxBin ?? "tmux";
    this.runTmux = opts.runTmux ?? ((args) => void spawnSync(this.tmuxBin, args, { stdio: "ignore" }));
    this.ptySpawn = opts.ptySpawn ?? defaultPtySpawn;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    const cols = Math.max(1, this.opts.cols ?? 80);
    const rows = Math.max(1, this.opts.rows ?? 24);
    const env: NodeJS.ProcessEnv = { ...(this.opts.env ?? process.env) };
    // Subscription auth only; and strip TMUX/TMUX_PANE so a server itself running inside tmux can't make
    // our `tmux` child think it's nesting (which makes it refuse / attach to the wrong server).
    delete env.ANTHROPIC_API_KEY;
    delete env.TMUX;
    delete env.TMUX_PANE;
    // ONE command on our dedicated socket: configure the server, THEN attach-or-create the session running
    // claude. `;` tokens are tmux command separators (no shell involved). `-A` = attach if it already exists.
    const args = [
      "-L",
      TMUX_SOCKET,
      ...tmuxConfigChain(),
      "new-session",
      "-A",
      "-s",
      this.tmuxName,
      "-x",
      String(cols),
      "-y",
      String(rows),
      "--",
      this.opts.claudeBin,
      ...(this.opts.claudeArgs ?? []),
    ];
    const pty = this.ptySpawn(this.tmuxBin, args, { name: "xterm-256color", cols, rows, cwd: this.opts.cwd, env });
    this.pty = pty;
    pty.onData((d) => this.emit("data", d));
    pty.onExit((e) => this.emit("exit", e));
  }

  write(d: string): void {
    this.pty?.write(d);
  }

  resize(c: number, r: number): void {
    // Clamp: a transient 0/NaN from a pre-layout fit() would otherwise hit ioctl(TIOCSWINSZ) and can throw.
    this.pty?.resize(Math.max(1, Math.trunc(c) || 1), Math.max(1, Math.trunc(r) || 1));
  }

  /** Detach (kill the pty client; tmux + claude keep running). `kill:true` also kills the tmux session. */
  stop(opts: { kill?: boolean } = {}): void {
    if (opts.kill) this.runTmux(["-L", TMUX_SOCKET, "kill-session", "-t", this.tmuxName]);
    try {
      this.pty?.kill();
    } catch {
      // pty already gone — best-effort
    }
    this.pty = undefined;
  }
}

/** Default spawner: lazy-load node-pty so a missing native module never breaks module import. */
const defaultPtySpawn: PtySpawn = (file, args, opts) => {
  const pty = require("node-pty") as typeof import("node-pty");
  return pty.spawn(file, args, opts) as unknown as IPty;
};

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface TerminalProcess {
  on(event: "data", listener: (chunk: string) => void): this;
  on(event: "exit", listener: (info: { exitCode: number }) => void): this;
  emit(event: "data", chunk: string): boolean;
  emit(event: "exit", info: { exitCode: number }): boolean;
}
