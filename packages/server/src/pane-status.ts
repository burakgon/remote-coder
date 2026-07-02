import { spawn } from "node:child_process";

/**
 * Classify a session's live ACTIVITY from its RENDERED tmux pane (`capture-pane -p` — the CURRENT screen, not
 * scrollback). UNIVERSAL: works for any running session regardless of how claude was spawned (no per-session
 * hooks needed), and works while the browser is DETACHED (it reads the tmux session directly). Grounded in
 * Claude Code's real output — see pane-status.test.ts for captured samples.
 *
 *   working  → claude's MAIN loop is busy. Tells:
 *              • an active spinner with a LIVE, PARENTHESISED elapsed timer: "Baking… (1m 34s · ↓ 5.3k tokens)"
 *                — the parenthesis is what separates the main spinner from a backgrounded agent's bare
 *                "24m 23s" (those are fire-and-forget workers listed under the status line, NOT the main state);
 *              • "Waiting for … to finish" (the main loop is blocked on a foreground agent/tool);
 *              • "esc to interrupt" (the interruptible-generation hint) is on screen.
 *   awaiting → none of those: claude is at rest → YOUR turn. A finished turn ("Baked for 23m 15s", past tense),
 *              an empty input prompt, or a permission/ask prompt.
 *
 * Conservative by DESIGN toward "awaiting": a missed "working" (mislabelling a busy session as waiting) is a
 * mildly early nudge; the reverse (a genuinely waiting session read as busy) would SILENCE a real "needs you",
 * which is the failure the user hit — so absence of a working tell resolves to awaiting.
 */
export function classifyPaneStatus(pane: string): "working" | "awaiting" {
  // A spinner's live parenthesised elapsed timer — "… (1m 34s" / "… (12s". The "(" distinguishes the MAIN
  // spinner from a backgrounded agent's bare "24m 23s" (no parenthesis).
  if (/…\s*\(\s*\d+\s*[ms]\b/.test(pane)) return "working";
  // Main loop blocked on a foreground agent/tool.
  if (/\bWaiting for\b[\s\S]{0,80}?\bto finish\b/i.test(pane)) return "working";
  // Interruptible generation (may be truncated to "e…" on a narrow phone pane, so it's a bonus, not the only tell).
  if (/\besc to interrupt\b/i.test(pane)) return "working";
  return "awaiting";
}

/** How capturePane locates a session's tmux pane. */
export interface CaptureOptions {
  tmuxBin?: string;
  socket: string;
  sessionName: string;
  timeoutMs?: number;
}

/**
 * Capture a tmux session's CURRENT pane as plain text (`capture-pane -p`, no escape sequences). READ-ONLY —
 * it never sends input or resizes, so it can NEVER disturb a live session. Best-effort: resolves "" on any
 * error/timeout and never throws. Async (non-blocking) so the activity monitor doesn't stall the event loop.
 */
export function capturePane(opts: CaptureOptions): Promise<string> {
  return new Promise((resolve) => {
    let out = "";
    let done = false;
    const finish = (s: string): void => {
      if (done) return;
      done = true;
      resolve(s);
    };
    try {
      const p = spawn(opts.tmuxBin ?? "tmux", ["-L", opts.socket, "capture-pane", "-p", "-t", opts.sessionName], {
        stdio: ["ignore", "pipe", "ignore"],
      });
      p.stdout?.on("data", (d: Buffer) => {
        out += d.toString("utf8");
        if (out.length > 65536) {
          try {
            p.kill();
          } catch {
            /* already gone */
          }
          finish(out);
        }
      });
      p.on("error", () => finish("")); // tmux missing / spawn failed → treat as "no data"
      p.on("close", () => finish(out));
      const t = setTimeout(() => {
        try {
          p.kill();
        } catch {
          /* already gone */
        }
        finish(out);
      }, opts.timeoutMs ?? 2000);
      if (typeof t.unref === "function") t.unref();
    } catch {
      finish("");
    }
  });
}
