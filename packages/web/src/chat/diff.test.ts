import { describe, expect, it } from "vitest";
import { lineDiff } from "./diff";

describe("lineDiff", () => {
  it("marks a single changed line as remove+add, keeping surrounding context", () => {
    expect(lineDiff("a\nb\nc", "a\nB\nc")).toEqual([
      { type: "context", text: "a" },
      { type: "remove", text: "b" },
      { type: "add", text: "B" },
      { type: "context", text: "c" },
    ]);
  });

  it("an identical string is all context", () => {
    expect(lineDiff("x\ny", "x\ny")).toEqual([
      { type: "context", text: "x" },
      { type: "context", text: "y" },
    ]);
  });

  it("a pure insertion keeps the common lines as context", () => {
    expect(lineDiff("a\nc", "a\nb\nc")).toEqual([
      { type: "context", text: "a" },
      { type: "add", text: "b" },
      { type: "context", text: "c" },
    ]);
  });

  it("a pure deletion keeps the common lines as context", () => {
    expect(lineDiff("a\nb\nc", "a\nc")).toEqual([
      { type: "context", text: "a" },
      { type: "remove", text: "b" },
      { type: "context", text: "c" },
    ]);
  });

  it("handles a complete replacement", () => {
    expect(lineDiff("old", "new")).toEqual([
      { type: "remove", text: "old" },
      { type: "add", text: "new" },
    ]);
  });
});
