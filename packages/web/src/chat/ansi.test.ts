import { describe, expect, it } from "vitest";
import { hasAnsi, stripAnsi } from "./ansi";

// Build escape sequences from char codes so the test source carries no raw control characters.
const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);

describe("stripAnsi", () => {
  it("removes SGR color codes, keeping the visible text", () => {
    expect(stripAnsi(`${ESC}[31mred${ESC}[0m`)).toBe("red");
    expect(stripAnsi(`a${ESC}[1;32mb${ESC}[0mc`)).toBe("abc");
  });

  it("leaves plain text (and newlines/tabs) untouched", () => {
    expect(stripAnsi("line1\nline2\tcol")).toBe("line1\nline2\tcol");
    expect(stripAnsi("no codes here")).toBe("no codes here");
  });

  it("removes an OSC (window-title) sequence terminated by BEL", () => {
    expect(stripAnsi(`${ESC}]0;my title${BEL}visible`)).toBe("visible");
  });

  it("strips a realistic colorized lint line", () => {
    const line = `${ESC}[2K${ESC}[1m${ESC}[31merror${ESC}[39m${ESC}[22m  Missing semicolon`;
    expect(stripAnsi(line)).toBe("error  Missing semicolon");
  });

  it("hasAnsi detects presence without mutating", () => {
    expect(hasAnsi(`${ESC}[31mx`)).toBe(true);
    expect(hasAnsi("plain")).toBe(false);
    // Stateful global regex must not get stuck across calls.
    expect(hasAnsi(`${ESC}[31mx`)).toBe(true);
  });
});
