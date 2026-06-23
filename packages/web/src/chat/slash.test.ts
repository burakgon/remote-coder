import { describe, expect, it } from "vitest";
import { matchSlash } from "./slash";

describe("matchSlash", () => {
  it("returns nothing when the text isn't a slash command", () => {
    expect(matchSlash("hello")).toEqual([]);
  });
  it("matches by prefix", () => {
    const names = matchSlash("/c").map((c) => c.name);
    expect(names).toContain("/clear");
    expect(names).toContain("/compact");
    expect(names).toContain("/cost");
    expect(names).not.toContain("/help");
  });
  it("lists all commands for a bare slash", () => {
    expect(matchSlash("/").length).toBeGreaterThanOrEqual(5);
  });
});
