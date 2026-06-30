// packages/server/test/terminal-real-tmux.integration.test.ts
// LIVE integration: real tmux + real node-pty (no mocks). This is the only test that proves the
// `tmuxConfigChain()` string actually PARSES when tmux executes it — a malformed chain would break spawning
// in production while every mocked unit test stays green. Also asserts the screen-fill invariants the user
// reported as broken: status bar OFF and the window BORN at the requested size (no stolen status row / reflow).
import { spawnSync } from "node:child_process";
import * as pty from "node-pty";
import { afterEach, expect, test } from "vitest";
import { TerminalProcess, TMUX_SOCKET } from "../src/terminal-process.js";

const hasTmux = spawnSync("tmux", ["-V"]).status === 0;
const tmux = (...args: string[]) => spawnSync("tmux", ["-L", TMUX_SOCKET, ...args], { encoding: "utf8" });

async function waitFor(pred: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 30));
  }
  return pred();
}

const SESSION_ID = `itg-${process.pid}`;
const TMUX_NAME = `rc-${SESSION_ID}`;

afterEach(() => {
  // belt-and-suspenders: never leak a live tmux session out of the test
  tmux("kill-session", "-t", TMUX_NAME);
});

test.skipIf(!hasTmux)(
  "real tmux: config chain parses, status bar off, born at requested size, input/output round-trips, clean kill",
  async () => {
    const tp = new TerminalProcess({
      sessionId: SESSION_ID,
      cwd: process.cwd(),
      claudeBin: "/bin/bash", // stand-in for claude: a real interactive program under the real PTY
      cols: 123,
      rows: 37,
      ptySpawn: pty.spawn as never,
      runTmux: (args) => void spawnSync("tmux", args),
      env: { ...process.env, PS1: "$ " },
    });
    const out: string[] = [];
    tp.on("data", (d) => out.push(d));
    tp.start();

    // 1) The session actually came up — i.e. tmux did not choke on the chained set-option config.
    const up = await waitFor(() => tmux("has-session", "-t", TMUX_NAME).status === 0, 4000);
    expect(up).toBe(true);

    // 2) Status bar is OFF (this is what was stealing a row and making the TUI look "shifted").
    const status = tmux("show-options", "-t", TMUX_NAME, "-g", "status").stdout.trim();
    expect(status).toMatch(/^status off$/m);

    // 3) Window BORN at the requested size with no status row stolen → fills the viewport on frame 1.
    const size = tmux("display-message", "-p", "-t", TMUX_NAME, "#{window_width}x#{window_height}").stdout.trim();
    expect(size).toBe("123x37");

    // 4) Input reaches the PTY and output flows back over the bridge.
    tp.write("echo round_trip_ok\n");
    const echoed = await waitFor(() => out.join("").includes("round_trip_ok"), 4000);
    expect(echoed).toBe(true);

    // 5) Resize is honored by the live session.
    tp.resize(90, 24);
    const resized = await waitFor(
      () => tmux("display-message", "-p", "-t", TMUX_NAME, "#{window_width}x#{window_height}").stdout.trim() === "90x24",
      4000,
    );
    expect(resized).toBe(true);

    // 6) kill actually destroys the session on the dedicated socket.
    tp.stop({ kill: true });
    const gone = await waitFor(() => tmux("has-session", "-t", TMUX_NAME).status !== 0, 4000);
    expect(gone).toBe(true);
  },
);
