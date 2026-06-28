/// <reference lib="webworker" />
import { precacheAndRoute } from "workbox-precaching";
import { parsePushPayload, notificationOptions, clickTargetUrl, applyBadgeFromPush } from "./sw-handlers";

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

// Precache the built shell (vite-plugin-pwa injects the manifest here at build time) — same offline
// behavior as the old generateSW config. Navigation/API behavior is governed server-side (the SPA
// fallback + the API/WS/health/push routes are never precached; only static assets are).
precacheAndRoute(self.__WB_MANIFEST);

// Activate immediately so a freshly registered SW can receive pushes without a reload.
self.addEventListener("install", () => void self.skipWaiting());
self.addEventListener("activate", (event: ExtendableEvent) => event.waitUntil(self.clients.claim()));

// Web Push: show the notification the server sent, and set the home-screen app badge to the awaiting count
// carried in the payload — so the badge updates even when the app is CLOSED (the running app clears/refreshes
// it on foreground). Both are feature-detected/best-effort and never throw out of the handler.
self.addEventListener("push", (event: PushEvent) => {
  const payload = parsePushPayload(event.data?.text());
  applyBadgeFromPush(payload, self.navigator);
  event.waitUntil(self.registration.showNotification(payload.title, notificationOptions(payload)));
});

// Notification click: focus an existing app window (deep-linking it to the session) or open one.
self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();
  const url = clickTargetUrl(event.notification);
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of all) {
        if ("focus" in client) {
          await (client as WindowClient).focus();
          if ("navigate" in client) await (client as WindowClient).navigate(url).catch(() => undefined);
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
