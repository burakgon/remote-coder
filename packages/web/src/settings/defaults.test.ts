import { afterEach, describe, expect, it } from "vitest";
import { loadDefaults, saveDefaults } from "./defaults";

afterEach(() => localStorage.clear());

describe("session defaults", () => {
  it("returns safe fallbacks when nothing is stored", () => {
    expect(loadDefaults()).toEqual({ effort: "medium", permissionMode: "default", dangerouslySkip: false });
  });
  it("round-trips saved defaults", () => {
    saveDefaults({ effort: "high", model: "opus", permissionMode: "acceptEdits", dangerouslySkip: true });
    expect(loadDefaults()).toEqual({ effort: "high", model: "opus", permissionMode: "acceptEdits", dangerouslySkip: true });
  });
  it("ignores corrupt storage and falls back", () => {
    localStorage.setItem("remote-coder.defaults", "not json");
    expect(loadDefaults().effort).toBe("medium");
  });
});
