import { timingSafeEqual } from "node:crypto";

export function extractBearerToken(authorizationHeader: string | undefined): string | undefined {
  if (!authorizationHeader) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  return match ? match[1] : undefined;
}

/** Constant-time string compare that does not leak length via early return. */
function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  // timingSafeEqual requires equal lengths; compare against a fixed-length digest-free padding.
  if (bufA.length !== bufB.length) {
    // Still do a compare to keep timing uniform, then return false.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export interface AuthGateOptions {
  token?: string;
  /** Consecutive failures from one client before it is locked out. Default 10. */
  maxFailures?: number;
  /** Lockout duration in ms. Default 60000. */
  lockoutMs?: number;
  /** Injectable clock for tests. Default Date.now. */
  now?: () => number;
}

export type AuthCheckResult = { ok: true } | { ok: false; reason: "locked" | "invalid" | "missing-token-config" };

interface ClientState {
  failures: number;
  lockedUntil: number;
}

/**
 * Verifies a bearer access token in constant time and applies a per-client
 * lockout after repeated failures. Pure / I/O-free so it is unit-testable;
 * Task 8 wires it as a single global Fastify `preHandler` that also gates the
 * WebSocket upgrade.
 *
 * Proxy lockout caveat: the lockout is keyed by `clientKey`, which Task 8 sets
 * to `request.ip`. Behind a reverse proxy (Caddy / Cloudflare), `request.ip`
 * is the proxy's IP for every client, so the per-client lockout collapses to
 * one shared key (a self-DoS: one attacker locks out everyone). `AuthGate`
 * stays IP-agnostic — it hashes whatever `clientKey` it is given; the
 * deployment must supply a real per-client key. Per-client lockout therefore
 * requires Fastify's `trustProxy` (so `request.ip` derives from
 * `X-Forwarded-For`) or an equivalent forwarded-IP source when running behind
 * a proxy.
 */
export class AuthGate {
  private readonly token?: string;
  private readonly maxFailures: number;
  private readonly lockoutMs: number;
  private readonly now: () => number;
  private readonly clients = new Map<string, ClientState>();

  constructor(opts: AuthGateOptions) {
    this.token = opts.token;
    this.maxFailures = opts.maxFailures ?? 10;
    this.lockoutMs = opts.lockoutMs ?? 60000;
    this.now = opts.now ?? Date.now;
  }

  check(presentedToken: string | undefined, clientKey: string): AuthCheckResult {
    if (!this.token) return { ok: false, reason: "missing-token-config" };
    this.sweepExpired();

    const state = this.clients.get(clientKey) ?? { failures: 0, lockedUntil: 0 };
    const t = this.now();
    if (state.lockedUntil > t) return { ok: false, reason: "locked" };

    const valid = presentedToken !== undefined && constantTimeEqual(presentedToken, this.token);
    if (valid) {
      this.clients.delete(clientKey); // reset on success
      return { ok: true };
    }

    state.failures += 1;
    if (state.failures >= this.maxFailures) {
      state.lockedUntil = t + this.lockoutMs;
      state.failures = 0; // reset the counter; the lock now governs
    }
    this.clients.set(clientKey, state);
    return { ok: false, reason: "invalid" };
  }

  /** Drop entries whose lockout has expired and whose failure count is 0 — keeps the map bounded. */
  private sweepExpired(): void {
    const t = this.now();
    for (const [key, state] of this.clients) {
      if (state.lockedUntil <= t && state.failures === 0) this.clients.delete(key);
    }
  }

  /** TEST ONLY: number of tracked clients currently locked (lockedUntil in the future). */
  lockedClientCount(): number {
    const t = this.now();
    let n = 0;
    for (const state of this.clients.values()) if (state.lockedUntil > t) n += 1;
    return n;
  }
}
