/**
 * Keep the `--app-height` CSS variable in sync with the VISUAL viewport — the slice of the screen NOT
 * covered by the on-screen keyboard — so the app shell shrinks to the space above the keyboard instead of
 * being overlapped by it.
 *
 * Why this is needed: the layout is `height: 100%` (→ `--app-height`) end-to-end. On iOS Safari the on-screen
 * keyboard OVERLAYS the page — `window.innerHeight`, `100%`, and `100dvh` do NOT shrink — so the bottom of
 * the app (the terminal's cursor line, the chat composer) ends up hidden BEHIND the keyboard, and the user
 * has to manually scroll/drag it into view. `window.visualViewport` reports the true visible height; we
 * mirror it into `--app-height`, which `#root` consumes, so the whole shell (and the terminal host inside it,
 * whose ResizeObserver then refits) collapses to the visible area. On Chrome/Android
 * `interactive-widget=resizes-content` (index.html) already resizes the layout viewport and visualViewport
 * agrees, so the two mechanisms never fight.
 */

/**
 * The height (in CSS px) the app shell should occupy: the visual-viewport height when available (keyboard-
 * aware), else the layout height. Rounded, and floored at 1px so a transient 0 can never collapse the UI.
 * Pure + unit-testable (no DOM).
 */
export function appHeightPx(vv: { height: number } | undefined | null, fallbackHeight: number): number {
  const h = vv?.height;
  const chosen = typeof h === "number" && h > 0 ? h : fallbackHeight;
  return Math.max(1, Math.round(chosen));
}

/**
 * Start mirroring the visual viewport into `--app-height` and return a disposer. Idempotent-safe to call
 * once at boot (the returned disposer is only needed by tests). Degrades gracefully: with no
 * `visualViewport` (old browsers) it sets the current layout height once and simply never updates — the
 * `100%` fallback in CSS already covers that case.
 */
export function installViewportSync(win: Window = window): () => void {
  const rootEl = win.document.documentElement;
  const vv = win.visualViewport ?? undefined;
  let raf = 0;
  const apply = (): void => {
    raf = 0;
    rootEl.style.setProperty("--app-height", `${appHeightPx(vv, win.innerHeight)}px`);
    // When the on-screen keyboard is UP, the shell is sized to the visual viewport so the key bar already
    // sits ABOVE the keyboard — the bottom safe-area inset then becomes dead space ("the gap"). Zero it out
    // while the keyboard is open; restore the real inset otherwise. Consumers read var(--kb-safe-bottom).
    const kbOpen = !!vv && win.innerHeight - vv.height > 120;
    rootEl.style.setProperty("--kb-safe-bottom", kbOpen ? "0px" : "env(safe-area-inset-bottom, 0px)");
  };
  const schedule = (): void => {
    // Coalesce the burst of resize/scroll events the keyboard animation fires into one write per frame.
    if (raf) return;
    raf = win.requestAnimationFrame(apply);
  };
  const onShow = (): void => {
    // iOS standalone PWA: after an IN-PLACE reload (the OTA path calls window.location.reload()), the
    // layout/visual viewport can stay DESYNCED — the UI paints correctly but touch hit-testing lands offset,
    // so nothing is tappable until the app is reopened. Resetting any phantom document scroll + re-syncing
    // the height realigns hit-testing. `pageshow` fires on the initial load, a reload, AND a bfcache restore,
    // so this heals "first open after OTA" without a manual reopen.
    try {
      win.scrollTo(0, 0);
    } catch {
      /* no scrollTo (jsdom) — ignore */
    }
    schedule();
  };
  apply(); // set immediately so the very first paint is already keyboard-aware
  if (vv) {
    vv.addEventListener("resize", schedule);
    vv.addEventListener("scroll", schedule);
  }
  win.addEventListener("orientationchange", schedule);
  win.addEventListener("pageshow", onShow);
  return () => {
    if (raf) win.cancelAnimationFrame(raf);
    if (vv) {
      vv.removeEventListener("resize", schedule);
      vv.removeEventListener("scroll", schedule);
    }
    win.removeEventListener("orientationchange", schedule);
    win.removeEventListener("pageshow", onShow);
  };
}
