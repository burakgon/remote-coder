/// <reference types="vite-plugin-pwa/client" />
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import "./styles/global.css";
import { App } from "./App";

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
    window.location.reload();
  });
}
registerSW({ immediate: true });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
