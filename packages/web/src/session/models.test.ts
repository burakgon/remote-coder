import { describe, expect, it } from "vitest";
import { modelOptions, FALLBACK_MODELS } from "./models";
import type { SessionMeta } from "../types/server";

const meta = (over: Partial<SessionMeta>): SessionMeta => ({
  id: "s",
  cwd: "/p",
  dangerouslySkip: false,
  status: "running",
  createdAt: 1,
  ...over,
});

describe("modelOptions", () => {
  it("uses the account's REAL model list when a session reports it", () => {
    const real = [
      { value: "default", displayName: "Default (recommended)" },
      { value: "opus[1m]", displayName: "Opus" },
    ];
    expect(modelOptions([meta({}), meta({ availableModels: real })])).toBe(real);
  });

  it("falls back to the curated static list when no session reports models", () => {
    expect(modelOptions([meta({})])).toBe(FALLBACK_MODELS);
    expect(modelOptions([])).toBe(FALLBACK_MODELS);
    expect(modelOptions([meta({ availableModels: [] })])).toBe(FALLBACK_MODELS);
  });

  it("the fallback offers a Default plus the common models", () => {
    expect(FALLBACK_MODELS[0]!.value).toBe(""); // empty = let the server default decide
    expect(FALLBACK_MODELS.map((m) => m.displayName)).toEqual(expect.arrayContaining(["Opus", "Sonnet", "Haiku"]));
  });
});
