/**
 * Lightweight, in-memory, per-client rate limiter for the global preHandler. The per-IP auth LOCKOUT
 * (auth.ts) only counts FAILED auth attempts and collapses behind a proxy; this adds a generous request
 * cap so a flood (auth-guessing, scraping, accidental client loop) can't hammer the host — while staying
 * well clear of any legitimate use (the PWA's periodic /sessions + /version poll, a burst of opens).
 *
 * Algorithm: a TOKEN BUCKET per client key (request.ip, honoring trustProxy — same key as the lockout).
 * `capacity` tokens, refilled continuously at `capacity / windowMs` tokens/ms; each request spends one.
 * A token bucket allows a short BURST (up to `capacity`) yet bounds the sustained rate — friendlier to
 * bursty real traffic than a hard fixed window. PURE/I-O-free + an injectable clock so it is unit-testable.
 *
 * SAFE DEFAULTS (see server-config.ts): 600 requests / 60s sustained, burst 120 — orders of magnitude
 * above the app's real cadence. Env-overridable and fully DISABLE-able (enabled:false → allow everything).
 */

export interface RateLimiterOptions {
  /** Sustained budget: `capacity` requests refill over `windowMs` (→ capacity/windowMs tokens per ms). */
  capacity: number;
  /** Refill window in ms for the full capacity. */
  windowMs: number;
  /** Max burst (bucket size). Defaults to `capacity`. A larger value tolerates a bigger instantaneous spike. */
  burst?: number;
  /** Master switch. false → {@link RateLimiter.take} always allows (the limiter is off). Default true. */
  enabled?: boolean;
  /** Injectable clock for tests. Default Date.now. */
  now?: () => number;
}

export interface RateLimitDecision {
  /** True → allow the request (a token was spent or the limiter is off). */
  allowed: boolean;
  /** When NOT allowed, seconds the client should wait before retrying (for the Retry-After header). */
  retryAfterSeconds: number;
}

interface BucketState {
  /** Fractional tokens currently available. */
  tokens: number;
  /** Last refill timestamp (ms). */
  updatedAt: number;
}

export class RateLimiter {
  private readonly capacity: number;
  private readonly windowMs: number;
  private readonly burst: number;
  private readonly enabled: boolean;
  private readonly now: () => number;
  private readonly ratePerMs: number;
  private readonly clients = new Map<string, BucketState>();

  constructor(opts: RateLimiterOptions) {
    this.capacity = opts.capacity;
    this.windowMs = opts.windowMs;
    this.burst = opts.burst ?? opts.capacity;
    this.enabled = opts.enabled ?? true;
    this.now = opts.now ?? Date.now;
    // Guard against a degenerate config (windowMs<=0): treat as instant refill (effectively no sustained cap).
    this.ratePerMs = this.windowMs > 0 ? this.capacity / this.windowMs : Number.POSITIVE_INFINITY;
  }

  /**
   * Account for ONE request from `clientKey`. Refills the bucket by elapsed time, then spends a token if
   * one is available. Returns {allowed:true} when a token was spent (or the limiter is disabled), else
   * {allowed:false, retryAfterSeconds} — the whole-seconds wait until the next token is available.
   */
  take(clientKey: string): RateLimitDecision {
    if (!this.enabled) return { allowed: true, retryAfterSeconds: 0 };
    this.sweepFull();

    const t = this.now();
    const state = this.clients.get(clientKey) ?? { tokens: this.burst, updatedAt: t };
    // Refill: add the tokens accrued since the last touch, capped at the burst size.
    const elapsed = Math.max(0, t - state.updatedAt);
    state.tokens = Math.min(this.burst, state.tokens + elapsed * this.ratePerMs);
    state.updatedAt = t;

    if (state.tokens >= 1) {
      state.tokens -= 1;
      this.clients.set(clientKey, state);
      return { allowed: true, retryAfterSeconds: 0 };
    }
    // Out of tokens: time until one more accrues.
    const msToNext = this.ratePerMs > 0 ? (1 - state.tokens) / this.ratePerMs : Number.POSITIVE_INFINITY;
    const retryAfterSeconds = Number.isFinite(msToNext) ? Math.max(1, Math.ceil(msToNext / 1000)) : 1;
    this.clients.set(clientKey, state);
    return { allowed: false, retryAfterSeconds };
  }

  /** Drop fully-refilled buckets so the map stays bounded (a one-shot client doesn't linger forever). */
  private sweepFull(): void {
    const t = this.now();
    for (const [key, state] of this.clients) {
      const elapsed = Math.max(0, t - state.updatedAt);
      const tokens = Math.min(this.burst, state.tokens + elapsed * this.ratePerMs);
      if (tokens >= this.burst) this.clients.delete(key);
    }
  }

  /** TEST ONLY: number of tracked client buckets. */
  trackedClientCount(): number {
    return this.clients.size;
  }
}
