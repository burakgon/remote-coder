// packages/server/test/terminal-manager.test.ts
import { EventEmitter } from "node:events";
import { expect, test } from "vitest";
import { TerminalManager } from "../src/terminal-manager.js";
import { openSessionStore } from "../src/session-store.js";

function fakePtyFactory() {
  const ptys: EventEmitter[] = [];
  const spawn = () => {
    const ee = new EventEmitter() as EventEmitter & { write(d: string): void; resize(c: number, r: number): void; kill(): void; onData(cb: (d: string) => void): void; onExit(cb: (e: { exitCode: number }) => void): void };
    ee.write = () => {};
    ee.resize = () => {};
    ee.kill = () => {};
    ee.onData = (cb) => void ee.on("data", cb);
    ee.onExit = (cb) => void ee.on("exit", cb);
    ptys.push(ee);
    return ee;
  };
  return { spawn, ptys };
}

function mgr() {
  const store = openSessionStore({ dbPath: ":memory:" });
  const { spawn, ptys } = fakePtyFactory();
  let t = 0;
  const m = new TerminalManager({ store, claudeBin: "claude", now: () => ++t, ptySpawn: spawn as never, runTmux: () => {} });
  return { m, store, ptys };
}

test("create persists a terminal row; attach spawns pty and fans data", () => {
  const { m, store, ptys } = mgr();
  const meta = m.create({ id: "s1", cwd: "/w" });
  expect(meta.mode).toBe("terminal");
  expect(store.get("s1")?.mode).toBe("terminal");

  const seen: string[] = [];
  const sub = m.attach("s1", (d) => seen.push(d));
  expect(sub).toBeDefined();
  ptys[0]!.emit("data", "redraw");
  expect(seen).toEqual(["redraw"]);
});

test("rehydrate marks stored terminal sessions whose tmux session is alive", () => {
  const { m, store } = mgr();
  store.upsert({ id: "old", cwd: "/w", mode: "terminal", dangerouslySkip: false, status: "running", createdAt: 1, lastActivityAt: 1 });
  m.rehydrate({ liveTmuxNames: ["rc-old"] });
  expect(m.get("old")?.status).toBe("running");
});

test("stop kills and removes", () => {
  const { m } = mgr();
  m.create({ id: "x", cwd: "/w" });
  m.attach("x", () => {});
  m.stop("x");
  expect(m.get("x")).toBeUndefined();
});
