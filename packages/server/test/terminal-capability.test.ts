import { expect, test } from "vitest";
import { detectTerminalSupport } from "../src/terminal-capability.js";

test("true only when tmux AND pty are available", () => {
  expect(detectTerminalSupport({ hasTmux: () => true, hasPty: () => true })).toBe(true);
  expect(detectTerminalSupport({ hasTmux: () => false, hasPty: () => true })).toBe(false);
  expect(detectTerminalSupport({ hasTmux: () => true, hasPty: () => false })).toBe(false);
});
