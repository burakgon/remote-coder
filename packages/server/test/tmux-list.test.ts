import { expect, test } from "vitest";
import { listTmuxSessions } from "../src/tmux-list.js";

test("parses session names; tolerates blank/error", () => {
  expect(listTmuxSessions(() => "rc-a\nrc-b\nother\n")).toEqual(["rc-a", "rc-b", "other"]);
  expect(listTmuxSessions(() => "")).toEqual([]);
  expect(listTmuxSessions(() => { throw new Error("no server"); })).toEqual([]);
});
