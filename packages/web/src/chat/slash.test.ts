import { describe, expect, it } from "vitest";
import { isSlashCommand, matchSlash } from "./slash";

describe("isSlashCommand", () => {
  it("is true for a slash command (even with leading whitespace or args)", () => {
    expect(isSlashCommand("/compact")).toBe(true);
    expect(isSlashCommand("  /model opus")).toBe(true);
  });
  it("is false for ordinary prose, empty, or undefined", () => {
    expect(isSlashCommand("hello /not-a-command")).toBe(false);
    expect(isSlashCommand("")).toBe(false);
    expect(isSlashCommand(undefined)).toBe(false);
  });
});

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
  it("matches /resume by prefix and marks it a client action (others are not)", () => {
    const resume = matchSlash("/r").find((c) => c.name === "/resume");
    expect(resume).toBeDefined();
    expect(resume?.clientAction).toBe(true);
    // A claude command (sent as text) is not a client action.
    expect(matchSlash("/clear")[0]?.clientAction).toBeFalsy();
  });
});
