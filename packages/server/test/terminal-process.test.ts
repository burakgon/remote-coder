// packages/server/test/terminal-process.test.ts
import { EventEmitter } from "node:events";
import { expect, test, vi } from "vitest";
import { TerminalProcess, tmuxSessionName } from "../src/terminal-process.js";

function fakePty() {
  const ee = new EventEmitter();
  const calls: { write: string[]; resize: [number, number][]; killed: number } = { write: [], resize: [], killed: 0 };
  const pty = {
    onData: (cb: (d: string) => void) => ee.on("data", cb),
    onExit: (cb: (e: { exitCode: number }) => void) => ee.on("exit", cb),
    write: (d: string) => calls.write.push(d),
    resize: (c: number, r: number) => calls.resize.push([c, r]),
    kill: () => void (calls.killed += 1),
    emitData: (d: string) => ee.emit("data", d),
    emitExit: (code: number) => ee.emit("exit", { exitCode: code }),
  };
  return { pty, calls };
}

test("start spawns tmux new -A -s rc-<id> -- claude and bridges data", () => {
  const { pty } = fakePty();
  const spawn = vi.fn(() => pty);
  const runTmux = vi.fn();
  const tp = new TerminalProcess({
    sessionId: "abc", cwd: "/work", claudeBin: "/bin/claude",
    cols: 100, rows: 30, ptySpawn: spawn as never, runTmux,
  });
  const seen: string[] = [];
  tp.on("data", (d) => seen.push(d));
  tp.start();

  expect(tmuxSessionName("abc")).toBe("rc-abc");
  const [file, args, opts] = spawn.mock.calls[0]!;
  expect(file).toBe("tmux");
  expect(args).toEqual(["new-session", "-A", "-s", "rc-abc", "-x", "100", "-y", "30", "--", "/bin/claude"]);
  expect(opts).toMatchObject({ name: "xterm-256color", cwd: "/work", cols: 100, rows: 30 });
  expect(opts.env.ANTHROPIC_API_KEY).toBeUndefined();
  // remain-on-exit set out-of-band so an accidental claude exit doesn't destroy the session
  expect(runTmux).toHaveBeenCalledWith(["set-option", "-t", "rc-abc", "remain-on-exit", "on"]);

  pty.emitData("hello");
  expect(seen).toEqual(["hello"]);
});

test("write + resize forward to the pty; stop(kill) kills tmux session", () => {
  const { pty, calls } = fakePty();
  const runTmux = vi.fn();
  const tp = new TerminalProcess({
    sessionId: "z", cwd: "/w", claudeBin: "claude", ptySpawn: (() => pty) as never, runTmux,
  });
  tp.start();
  tp.write("ls\n");
  tp.resize(80, 24);
  expect(calls.write).toEqual(["ls\n"]);
  expect(calls.resize).toEqual([[80, 24]]);

  tp.stop({ kill: true });
  expect(runTmux).toHaveBeenCalledWith(["kill-session", "-t", "rc-z"]);
  expect(calls.killed).toBe(1);
});

test("exit is re-emitted", () => {
  const { pty } = fakePty();
  const tp = new TerminalProcess({ sessionId: "e", cwd: "/w", claudeBin: "claude", ptySpawn: (() => pty) as never, runTmux: () => {} });
  const exits: number[] = [];
  tp.on("exit", (e) => exits.push(e.exitCode));
  tp.start();
  pty.emitExit(0);
  expect(exits).toEqual([0]);
});
