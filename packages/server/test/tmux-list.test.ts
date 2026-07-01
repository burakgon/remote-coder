import { expect, test } from "vitest";
import { listTmuxSessions } from "../src/tmux-list.js";

test("parses session names from a successful probe", () => {
  expect(listTmuxSessions(() => ({ ok: true, out: "rc-a\nrc-b\nother\n" }))).toEqual(["rc-a", "rc-b", "other"]);
  expect(listTmuxSessions(() => ({ ok: true, out: "" }))).toEqual([]); // definitive "no sessions"
});

test("returns undefined (NOT empty) when the probe failed, so the caller never prunes on a flaky tmux", () => {
  expect(listTmuxSessions(() => ({ ok: false, out: "" }))).toBeUndefined();
});
