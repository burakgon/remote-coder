/**
 * BOOT WATCHDOG decision logic (pure + testable).
 *
 * The app's React `ErrorBoundary` can only catch crashes AFTER the bundle loads and React mounts. If the
 * bundle itself fails to load/evaluate — an iOS-evicted precache chunk, a corrupt cached asset, or a
 * boot-time module-eval throw — `#root` stays empty and the user sees a GRAY SCREEN with NO in-app escape
 * (the ErrorBoundary lives inside the bundle that didn't load). On iOS that persists across close+reopen
 * (the same broken cache is served), so historically only an OTA (which re-precaches) recovered it.
 *
 * The fix is an INLINE script in index.html (which always ships with the document, independent of the
 * bundle) that watches for this and offers a self-heal (clear caches + unregister the SW + reload). This
 * module is the pure decision the inline script mirrors — kept here so the contract is unit-tested. The
 * inline copy in index.html MUST stay in sync with `shouldShowBootRecovery`.
 */
export interface BootState {
  /** window.__rcBooted — set by main.tsx once the bundle executed createRoot().render(). */
  booted: boolean;
  /** #root.childElementCount — non-zero once React (incl. the ErrorBoundary's own UI) has rendered. */
  rootChildCount: number;
  /** ms since the document started loading. */
  elapsedMs: number;
  /** the boot timeout — past this with nothing mounted, we assume a dead boot. */
  timeoutMs: number;
  /** a <script> resource failed to load (module bundle 404/parse) — a definite dead boot. */
  sawScriptError: boolean;
}

/**
 * TRUE when the app has demonstrably failed to boot and the recovery UI should be shown. The app is
 * considered ALIVE if `booted` is set OR `#root` has any child (the ErrorBoundary's own error UI counts —
 * that's a handled crash, not a gray screen, so we must NOT cover it). Otherwise a dead boot is declared on
 * a script-load error OR once the timeout elapses with nothing mounted.
 */
export function shouldShowBootRecovery(s: BootState): boolean {
  const alive = s.booted || s.rootChildCount > 0;
  if (alive) return false;
  if (s.sawScriptError) return true;
  return s.elapsedMs >= s.timeoutMs;
}

/** The boot timeout used by the inline watchdog (kept here so the test and the inline copy share a value). */
export const BOOT_TIMEOUT_MS = 12000;
