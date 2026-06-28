export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
  /** APP BADGE: total awaiting-session count at send time, so the SW can set the home-screen badge even
   *  while the app is CLOSED. Absent (older server / malformed) → the SW leaves the badge alone. */
  badgeCount?: number;
}

/** Defensive parse: the push body is attacker-influenced-ish (it comes from the push service), so a
 * malformed/empty payload must never throw inside the SW push handler — fall back to a generic shape. */
export function parsePushPayload(raw: string | undefined): PushPayload {
  const fallback: PushPayload = {
    title: "Remote Coder",
    body: "A session needs your attention",
    url: "/",
    tag: "remote-coder",
  };
  if (!raw) return fallback;
  try {
    const obj = JSON.parse(raw) as Partial<PushPayload>;
    return {
      title: typeof obj.title === "string" ? obj.title : fallback.title,
      body: typeof obj.body === "string" ? obj.body : fallback.body,
      url: typeof obj.url === "string" ? obj.url : fallback.url,
      tag: typeof obj.tag === "string" ? obj.tag : fallback.tag,
      // Only carry a finite, non-negative integer count (defensive against a malformed/poisoned payload);
      // anything else is dropped so the SW leaves the badge untouched.
      ...(typeof obj.badgeCount === "number" && Number.isInteger(obj.badgeCount) && obj.badgeCount >= 0
        ? { badgeCount: obj.badgeCount }
        : {}),
    };
  } catch {
    return fallback;
  }
}

/**
 * APP BADGE from a push: set the home-screen badge to the count carried in the push PAYLOAD, so a
 * backgrounded/closed app still shows a glanceable "needs you" count. FEATURE-DETECTED (the App Badging
 * API is absent on iOS Safari) and best-effort (the promise can reject) so it degrades silently and never
 * throws inside the SW push handler. A payload with no `badgeCount` (older server) leaves the badge alone.
 * `nav` is injectable for tests; defaults to the SW global `self.navigator`.
 */
export function applyBadgeFromPush(
  payload: PushPayload,
  nav: { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> } | undefined,
): void {
  if (payload.badgeCount === undefined) return;
  if (!nav || typeof nav.setAppBadge !== "function") return;
  try {
    if (payload.badgeCount > 0) {
      void nav.setAppBadge(payload.badgeCount)?.catch(() => {});
    } else if (typeof nav.clearAppBadge === "function") {
      void nav.clearAppBadge()?.catch(() => {});
    } else {
      void nav.setAppBadge(0)?.catch(() => {});
    }
  } catch {
    // never let a badge failure escape into the SW push handler
  }
}

export function notificationOptions(p: PushPayload): NotificationOptions {
  return {
    body: p.body,
    tag: p.tag,
    icon: "/icon-192.svg",
    badge: "/icon-192.svg",
    data: { url: p.url },
  };
}

export function clickTargetUrl(notification: { data?: unknown }): string {
  const data = notification.data as { url?: unknown } | undefined;
  return typeof data?.url === "string" ? data.url : "/";
}
