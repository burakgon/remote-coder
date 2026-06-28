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
  /**
   * Grace window (ms) after {@link AuthGate.rotateToken} during which the PREVIOUS token is still
   * accepted, so a callback already in flight with the old token (e.g. a running mcp-send subprocess that
   * captured RC_TOKEN at spawn) survives the rotation instead of 401-ing mid-conversation. Default 60000.
   */
  graceMs?: number;
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
  // NOT readonly: rotateToken() atomically swaps in a fresh secret (POST /token/rotate). Every subsequent
  // check() compares against the new token, so the OLD token is invalid the instant rotation completes —
  // except within the brief grace window below, where the PREVIOUS token is still accepted.
  private token?: string;
  // DUAL-TOKEN GRACE: the token rotation REPLACED, plus the wall time it stays acceptable until. Lets a
  // callback already in flight with the old token (a running mcp-send subprocess captured RC_TOKEN at
  // spawn; rewriting its 0600 config can't update the live process env) finish instead of 401-ing
  // mid-conversation. Only ONE previous token is ever retained — a 2nd rotation within the window
  // supersedes it with the most-recent old token (never a growing list).
  private previousToken?: string;
  private previousValidUntil = 0;
  private readonly maxFailures: number;
  private readonly lockoutMs: number;
  private readonly graceMs: number;
  private readonly now: () => number;
  private readonly clients = new Map<string, ClientState>();

  constructor(opts: AuthGateOptions) {
    this.token = opts.token;
    this.maxFailures = opts.maxFailures ?? 10;
    this.lockoutMs = opts.lockoutMs ?? 60000;
    this.graceMs = opts.graceMs ?? 60000;
    this.now = opts.now ?? Date.now;
  }

  check(presentedToken: string | undefined, clientKey: string): AuthCheckResult {
    if (!this.token) return { ok: false, reason: "missing-token-config" };
    this.sweepExpired();

    const state = this.clients.get(clientKey) ?? { failures: 0, lockedUntil: 0 };
    const t = this.now();
    if (state.lockedUntil > t) return { ok: false, reason: "locked" };

    // Accept the CURRENT token, OR — within the post-rotation grace window — the PREVIOUS one. Both go
    // through the same length-mismatch-safe constant-time compare (no early return leaks length). After
    // `previousValidUntil` the old token is dead. SECURITY: the grace is a marginal exposure — the old
    // token was already valid up to the instant of rotation; 60s more only lets in-flight MCP callbacks
    // (send_image/send_file/ask_user) complete, the deliberate tradeoff vs breaking attachments mid-turn.
    const matchesCurrent = presentedToken !== undefined && constantTimeEqual(presentedToken, this.token);
    const matchesPrevious =
      presentedToken !== undefined &&
      this.previousToken !== undefined &&
      t <= this.previousValidUntil &&
      constantTimeEqual(presentedToken, this.previousToken);
    const valid = matchesCurrent || matchesPrevious;
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

  /**
   * Atomically swap in a fresh access token (POST /token/rotate). Every subsequent {@link check} compares
   * against the new token; the OLD token is accepted only for a brief grace window (graceMs) so in-flight
   * callbacks holding it (a running mcp-send subprocess) survive the rotation instead of 401-ing mid-turn.
   * A 2nd rotation within the window REPLACES previousToken with the most-recent old token (no list grows).
   * Also clears all per-client lockout state — rotation is an explicit administrative reset, so a fresh
   * slate is correct (and avoids leaving a client locked out against a token that no longer exists).
   */
  rotateToken(newToken: string): void {
    // Retain the just-replaced token for the grace window — but ONLY when graceMs > 0, so graceMs:0 means
    // an UNAMBIGUOUS instant cutover (no previous token retained, no same-millisecond boundary acceptance).
    if (this.token !== undefined && this.graceMs > 0) {
      this.previousToken = this.token;
      this.previousValidUntil = this.now() + this.graceMs;
    } else {
      this.previousToken = undefined;
      this.previousValidUntil = 0;
    }
    this.token = newToken;
    this.clients.clear();
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
