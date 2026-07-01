/// <reference types="vite-plugin-pwa/client" />
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import "./styles/global.css";
import { App } from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import { installViewportSync } from "./pwa/viewport";

// Mirror the visual viewport into --app-height so the shell shrinks to the area above the on-screen keyboard
// (instead of the composer / terminal cursor hiding behind it). Started before render so the first paint is
// already keyboard-aware. Lives for the app's lifetime — no disposer needed.
installViewportSync();

// Auto-update the service worker (precached shell loads offline). With `registerType: "autoUpdate"`
// the new SW activates in the background (skipWaiting), but the OPEN page keeps running the stale JS
// until something reloads it — that's how a returning user can sit on an old bundle (e.g. missing the
// Stop button) even after "reopening". So: when a freshly-installed SW takes control, reload ONCE to
// pick up the new assets. Guarded against the very first install (no prior controller) so it never
// reload-loops on a fresh device.
if (typeof navigator !== "undefined" && navigator.serviceWorker) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading || !hadController) return;
    reloading = true;
    // replace(href), NOT reload(): an in-place reload() in an iOS standalone PWA can leave the compositor
    // frozen — the DOM updates + input keeps working, but the screen stops repainting until the app is
    // reopened. A replace() navigation swaps onto the new bundle without triggering that freeze.
    window.location.replace(window.location.href);
  });
}
registerSW({ immediate: true });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* Last-resort boundary: a render crash anywhere shows a recoverable error (with Reload =
        hardRefresh) instead of a silent gray screen. */}
    <ErrorBoundary variant="full">
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

// Tell the inline boot watchdog (index.html) that the bundle loaded + React started, so it never shows
// the gray-screen recovery for a healthy boot — and clear any overlay it raised during a slow load.
window.__rcBooted = true;
document.getElementById("rc-boot-recovery")?.remove();
