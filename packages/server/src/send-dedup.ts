/**
 * SEND IDEMPOTENCY (#9): the WS `user` frame can be RE-DELIVERED by the client's reconnect queue (a
 * message buffered during a blip is flushed on the next open — and an in-flight frame whose ack the
 * client never saw can be requeued). Without dedup the server would forward the SAME prompt to Claude
 * twice — dangerous for a "force push" / "delete" prompt that then runs twice.
 *
 * The client mints ONE `msgId` (a uuid) per distinct user action and REUSES it on a reconnect re-send,
 * so a requeued frame carries the same id. This guards the server side: a `msgId` already seen for a
 * session within a short TTL window is delivered to the CLI AT MOST ONCE. A resend with a known msgId is
 * acknowledged (silently dropped) but NOT re-sent. Frames with no msgId (older clients) are never
 * deduped — current behavior is preserved.
 *
 * In-memory + per-process: a send is in-flight for seconds, far shorter than a restart, so durability
 * across restarts isn't needed (and a duplicate across a restart is astronomically unlikely — the client
 * holds a frame only across a brief reconnect, not a server redeploy). TTL-evicted lazily on check and
 * bounded per session so a long-lived session can't accumulate ids without bound.
 */
export interface SendDedup {
  /**
   * Record a (sessionId, msgId) and report whether it is the FIRST occurrence within the TTL. Returns
   * true → forward to the CLI; false → a duplicate, drop it. A blank/absent msgId always returns true
   * (no dedup for older clients). `now` is injectable for deterministic TTL tests.
   */
  firstSeen(sessionId: string, msgId: string | undefined, now?: number): boolean;
  /** Forget a session's recorded msgIds (e.g. on deleteSession) so its memory is reclaimed. */
  forget(sessionId: string): void;
}

export interface CreateSendDedupOptions {
  /** Window (ms) within which a repeated msgId is treated as a duplicate. Default 60_000 (1 min) — well
   *  past any reconnect-flush latency, well under a restart. */
  ttlMs?: number;
  /** Max msgIds retained per session (oldest evicted past this). Default 256 — a session never has that
   *  many distinct sends in flight; this is the runaway ceiling. */
  maxPerSession?: number;
  /** Injectable clock for tests. Defaults to Date.now. */
  now?: () => number;
}

export function createSendDedup(opts: CreateSendDedupOptions = {}): SendDedup {
  const ttlMs = opts.ttlMs ?? 60_000;
  const maxPerSession = opts.maxPerSession ?? 256;
  const clock = opts.now ?? Date.now;
  // sessionId -> (msgId -> last-seen ms). A Map keeps insertion order so we can evict the oldest.
  const seen = new Map<string, Map<string, number>>();

  return {
    firstSeen: (sessionId, msgId, now) => {
      if (!msgId) return true; // older client / no id → never dedup (preserve current behavior)
      const at = now ?? clock();
      let perSession = seen.get(sessionId);
      if (!perSession) {
        perSession = new Map();
        seen.set(sessionId, perSession);
      }
      const prev = perSession.get(msgId);
      if (prev !== undefined && at - prev <= ttlMs) {
        // Known + within the window → a duplicate, drop it. The stamp is NOT refreshed: the TTL is
        // measured from the FIRST send, so the window can't be extended indefinitely by repeated resends
        // (and a genuinely-new action reusing the same id after the TTL is allowed through).
        return false;
      }
      // First occurrence (or the prior one aged out past the TTL → allowed again). Record it.
      perSession.delete(msgId); // re-insert at the end so eviction order tracks recency
      perSession.set(msgId, at);
      // Bound the per-session set: drop the oldest entries past the cap.
      while (perSession.size > maxPerSession) {
        const oldest = perSession.keys().next().value;
        if (oldest === undefined) break;
        perSession.delete(oldest);
      }
      return true;
    },
    forget: (sessionId) => void seen.delete(sessionId),
  };
}
