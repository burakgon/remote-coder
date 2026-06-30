// packages/server/src/terminal-manager.ts
import { TerminalProcess, tmuxSessionName, type PtySpawn } from "./terminal-process.js";
import type { SessionStore } from "./session-store.js";

export interface TerminalMeta {
  id: string;
  cwd: string;
  mode: "terminal";
  status: "running" | "ended";
  createdAt: number;
  lastActivityAt: number;
}

export interface TerminalSub {
  unsubscribe(): void;
}

interface Record_ {
  meta: TerminalMeta;
  claudeArgs: string[];
  cols: number;
  rows: number;
  proc?: TerminalProcess;
  subs: Set<(chunk: string) => void>;
}

export interface TerminalManagerDeps {
  store: SessionStore;
  claudeBin: string;
  now: () => number;
  ptySpawn?: PtySpawn;
  runTmux?: (args: string[]) => void;
  env?: NodeJS.ProcessEnv;
}

const clampDim = (n: number | undefined, fallback: number): number => Math.max(1, Math.trunc(n ?? fallback) || fallback);

export class TerminalManager {
  private readonly records = new Map<string, Record_>();
  constructor(private readonly deps: TerminalManagerDeps) {}

  create(opts: { id: string; cwd: string; claudeArgs?: string[]; cols?: number; rows?: number }): TerminalMeta {
    const now = this.deps.now();
    const meta: TerminalMeta = {
      id: opts.id, cwd: opts.cwd, mode: "terminal", status: "running", createdAt: now, lastActivityAt: now,
    };
    this.records.set(opts.id, {
      meta, claudeArgs: opts.claudeArgs ?? [], cols: clampDim(opts.cols, 80), rows: clampDim(opts.rows, 24), subs: new Set(),
    });
    this.deps.store.upsert({
      id: opts.id, cwd: opts.cwd, mode: "terminal", dangerouslySkip: false,
      status: "running", createdAt: now, lastActivityAt: now,
    });
    return meta;
  }

  /**
   * Subscribe to a terminal's output. The pty/tmux is spawned lazily on the FIRST subscriber — and, when
   * `size` is given, born at exactly the client's fitted viewport so the claude TUI's first frame matches
   * (no spawn-at-80×24-then-reflow jump). Returns undefined for an unknown id.
   */
  attach(id: string, onData: (chunk: string) => void, size?: { cols: number; rows: number }): TerminalSub | undefined {
    const rec = this.records.get(id);
    if (!rec) return undefined;
    if (size && !rec.proc) {
      rec.cols = clampDim(size.cols, rec.cols);
      rec.rows = clampDim(size.rows, rec.rows);
    }
    rec.subs.add(onData);
    if (!rec.proc) {
      const proc = new TerminalProcess({
        sessionId: id, cwd: rec.meta.cwd, claudeBin: this.deps.claudeBin,
        claudeArgs: rec.claudeArgs, cols: rec.cols, rows: rec.rows,
        ...(this.deps.env ? { env: this.deps.env } : {}),
        ...(this.deps.ptySpawn ? { ptySpawn: this.deps.ptySpawn } : {}),
        ...(this.deps.runTmux ? { runTmux: this.deps.runTmux } : {}),
      });
      proc.on("data", (chunk) => {
        for (const cb of rec.subs) cb(chunk);
      });
      proc.on("exit", () => {
        rec.meta.status = "ended";
      });
      rec.proc = proc;
      proc.start();
    }
    return {
      unsubscribe: () => {
        rec.subs.delete(onData);
        // No subscribers left → detach the pty client; tmux + claude keep running for reconnect.
        if (rec.subs.size === 0 && rec.proc) {
          rec.proc.removeAllListeners();
          rec.proc.stop();
          rec.proc = undefined;
        }
      },
    };
  }

  write(id: string, data: string): void {
    const rec = this.records.get(id);
    rec?.proc?.write(data);
    if (rec) {
      rec.meta.lastActivityAt = this.deps.now();
      this.deps.store.touch(id, rec.meta.lastActivityAt);
    }
  }

  resize(id: string, cols: number, rows: number): void {
    const rec = this.records.get(id);
    if (!rec) return;
    rec.cols = clampDim(cols, rec.cols);
    rec.rows = clampDim(rows, rec.rows);
    rec.proc?.resize(rec.cols, rec.rows);
  }

  stop(id: string): void {
    const rec = this.records.get(id);
    if (rec?.proc) rec.proc.stop({ kill: true });
    else this.killTmux(id);
    this.records.delete(id);
    this.deps.store.delete(id);
  }

  get(id: string): TerminalMeta | undefined {
    return this.records.get(id)?.meta;
  }

  list(): TerminalMeta[] {
    return [...this.records.values()].map((r) => r.meta);
  }

  /**
   * After a server/OTA restart: adopt stored terminal sessions whose tmux session is still alive (so they
   * reappear, resumable), prune store rows whose tmux session is gone, AND kill ORPHAN tmux sessions — live
   * `rc-*` sessions with no store row (leaked by a crash or an interrupted cleanup) — so they don't pile up.
   */
  rehydrate(opts: { liveTmuxNames: string[] }): void {
    const live = new Set(opts.liveTmuxNames);
    const storedTerminalIds = new Set(
      this.deps.store.list().filter((s) => s.mode === "terminal").map((s) => s.id),
    );
    for (const s of this.deps.store.list()) {
      if (s.mode !== "terminal") continue;
      if (!live.has(tmuxSessionName(s.id))) {
        this.deps.store.delete(s.id); // tmux session gone → prune the stale row
        continue;
      }
      if (this.records.has(s.id)) continue;
      this.records.set(s.id, {
        meta: { id: s.id, cwd: s.cwd, mode: "terminal", status: "running", createdAt: s.createdAt, lastActivityAt: s.lastActivityAt },
        claudeArgs: [], cols: 80, rows: 24, subs: new Set(),
      });
    }
    for (const name of opts.liveTmuxNames) {
      if (!name.startsWith("rc-")) continue;
      const id = name.slice(3);
      if (!storedTerminalIds.has(id)) this.killTmux(id); // orphan → reap
    }
  }

  /** Kill a tmux session for an id without needing a live proc (reuses TerminalProcess's socketed kill). */
  private killTmux(id: string): void {
    new TerminalProcess({
      sessionId: id,
      cwd: "/",
      claudeBin: this.deps.claudeBin,
      ...(this.deps.runTmux ? { runTmux: this.deps.runTmux } : {}),
    }).stop({ kill: true });
  }
}
