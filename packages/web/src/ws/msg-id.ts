/**
 * Mint a client-side idempotency key for ONE user submission (SEND IDEMPOTENCY, #9). The composer calls
 * this once per send and attaches the result as the `user` frame's `msgId`. Because the frame object
 * (with its msgId) is what the reconnect queue buffers and re-sends, a frame requeued after a connection
 * blip carries the SAME id — so the server delivers it to Claude at most once.
 *
 * Prefers the platform `crypto.randomUUID()` (a secure-context global in every modern browser and in the
 * test jsdom env). Falls back to a random-enough id if it's somehow unavailable — collision risk is
 * irrelevant here (the id only needs to be unique within one session's short reconnect window).
 */
export function mintMsgId(): string {
  const c = typeof crypto !== "undefined" ? crypto : undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
