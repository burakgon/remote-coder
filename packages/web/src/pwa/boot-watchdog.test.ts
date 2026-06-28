import { describe, expect, it } from "vitest";
import { shouldShowBootRecovery, BOOT_TIMEOUT_MS } from "./boot-watchdog";

const base = { booted: false, rootChildCount: 0, elapsedMs: 0, timeoutMs: BOOT_TIMEOUT_MS, sawScriptError: false };

describe("shouldShowBootRecovery — the gray-screen escape-hatch decision", () => {
  it("stays quiet while the app is still early in a normal boot (nothing mounted yet, no error, pre-timeout)", () => {
    expect(shouldShowBootRecovery({ ...base, elapsedMs: 2000 })).toBe(false);
  });

  it("never shows once the bundle booted (window.__rcBooted) — even at/after the timeout", () => {
    expect(shouldShowBootRecovery({ ...base, booted: true, elapsedMs: BOOT_TIMEOUT_MS + 5000 })).toBe(false);
  });

  it("never shows once #root has rendered children — incl. the ErrorBoundary's OWN error UI (a handled crash is not a gray screen)", () => {
    expect(shouldShowBootRecovery({ ...base, rootChildCount: 1, sawScriptError: true })).toBe(false);
    expect(shouldShowBootRecovery({ ...base, rootChildCount: 1, elapsedMs: BOOT_TIMEOUT_MS + 1 })).toBe(false);
  });

  it("shows IMMEDIATELY on a script-load error with nothing mounted (the bundle 404'd / failed to parse)", () => {
    expect(shouldShowBootRecovery({ ...base, sawScriptError: true, elapsedMs: 500 })).toBe(true);
  });

  it("shows once the timeout elapses with nothing mounted (silent dead boot — the gray screen)", () => {
    expect(shouldShowBootRecovery({ ...base, elapsedMs: BOOT_TIMEOUT_MS })).toBe(true);
    expect(shouldShowBootRecovery({ ...base, elapsedMs: BOOT_TIMEOUT_MS + 9999 })).toBe(true);
  });

  it("a script error AFTER the app is alive is ignored (a lazy chunk failing later isn't a gray screen)", () => {
    expect(shouldShowBootRecovery({ ...base, booted: true, sawScriptError: true })).toBe(false);
  });
});
