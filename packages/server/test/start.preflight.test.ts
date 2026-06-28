import { describe, expect, test, vi } from "vitest";
import { claudePreflightWarning, runClaudePreflight } from "../src/index.js";
import type { ClaudeAvailability, ClaudeVersionProbe } from "../src/index.js";

function probeOf(value: ClaudeAvailability): ClaudeVersionProbe {
  return { get: async () => value };
}

describe("claudePreflightWarning", () => {
  test("no warning when claude is available", () => {
    expect(claudePreflightWarning({ available: true, version: "1.2.3" })).toBeUndefined();
  });

  test("actionable warning when claude is unavailable", () => {
    const msg = claudePreflightWarning({ available: false });
    expect(msg).toBeTruthy();
    expect(msg).toMatch(/`claude` CLI not found/i);
    expect(msg).toMatch(/PATH/);
    expect(msg).toMatch(/authenticate/i);
  });
});

describe("runClaudePreflight", () => {
  test("warns (once) when the probe reports unavailable", async () => {
    const warn = vi.fn();
    await runClaudePreflight(probeOf({ available: false }), warn);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatch(/not found/i);
  });

  test("stays quiet when the probe reports available", async () => {
    const warn = vi.fn();
    await runClaudePreflight(probeOf({ available: true, version: "9.9.9" }), warn);
    expect(warn).not.toHaveBeenCalled();
  });

  test("a throwing probe is treated as unavailable and still warns (never rejects)", async () => {
    const warn = vi.fn();
    const probe: ClaudeVersionProbe = {
      get: async () => {
        throw new Error("boom");
      },
    };
    await expect(runClaudePreflight(probe, warn)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
