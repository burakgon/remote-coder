import { loadConfig } from "./config.js";
import { resolveDataDir } from "./data-dir.js";
import { parseAllowedOrigins } from "./origin-check.js";
import type { ServerConfig } from "./config.js";

/** Safe defaults for the new security/limit controls (generous; never bother a real self-hoster). */
export const DEFAULT_RATE_LIMIT_RPM = 600; // sustained requests/minute per client (way above the app's poll)
export const DEFAULT_RATE_LIMIT_BURST = 120; // instantaneous burst allowance (a flurry of opens/polls)
export const DEFAULT_MAX_SESSIONS = 25; // max concurrent LIVE claude sessions/processes

export interface ServerRuntimeConfig {
  /** TCP port to listen on. Default 4280. */
  port: number;
  /** Address to bind. Default "127.0.0.1" (loopback). */
  bindAddress: string;
  /** Mandatory access token. Optional only for loopback binds (spec §9). */
  accessToken?: string;
  /** Root directory the file picker / fs-service is confined to. Default $HOME or cwd. */
  fsRoot: string;
  /** Max bytes accepted for an upload. Default 25 MiB. */
  maxUploadBytes: number;
  /** Host data dir for the SQLite DB + access token file. */
  dataDir: string;
  /**
   * Trust X-Forwarded-* (passed to Fastify as `trustProxy`). Default false.
   * Set true when running behind a reverse proxy (Caddy/Cloudflare) so `request.ip` is the
   * real client IP — otherwise the per-client auth lockout collapses to the proxy's single IP.
   */
  trustProxy?: boolean;
  /**
   * The public-facing origin (REMOTE_CODER_PUBLIC_URL). Used by the Origin/CSWSH guard as an allow-listed
   * origin (the PWA is installed under this when behind a tunnel) AND by start.ts for push deep-links.
   */
  publicUrl?: string;
  /**
   * Extra Origins the CSWSH guard allows, beyond same-origin / loopback / publicUrl
   * (REMOTE_CODER_ALLOWED_ORIGINS, comma-separated). Empty by default — the safe default already lets the
   * real app through; this is only to permit an additional known front-end origin.
   */
  allowedOrigins: string[];
  /**
   * Global per-client request rate limit (token bucket). `rateLimitRpm` requests/minute sustained,
   * `rateLimitBurst` instantaneous. Set rateLimitRpm to 0 to DISABLE the limiter entirely.
   * (REMOTE_CODER_RATE_LIMIT_RPM / REMOTE_CODER_RATE_LIMIT_BURST.)
   */
  rateLimitRpm: number;
  rateLimitBurst: number;
  /** Max concurrent LIVE sessions/processes; POST /sessions is refused (429) at the cap. 0 disables the
   *  cap. (REMOTE_CODER_MAX_SESSIONS.) */
  maxSessions: number;
  /** The claude-spawn config (claudeBin + default model/effort). */
  claude: ServerConfig;
}

/**
 * Parse an integer env option. An ABSENT or UNPARSEABLE value falls back to the default (lenient);
 * a present-but-out-of-range value is a configuration ERROR (fail fast at boot).
 */
function parseIntOption(
  raw: string | undefined,
  fallback: number,
  name: string,
  range: { min?: number; max?: number },
): number {
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  if ((range.min !== undefined && n < range.min) || (range.max !== undefined && n > range.max)) {
    throw new Error(`invalid ${name}: ${raw} (must be ${range.min ?? "-∞"}..${range.max ?? "∞"})`);
  }
  return n;
}

export function loadServerConfig(env: NodeJS.ProcessEnv): ServerRuntimeConfig {
  // PORT 0 is a legitimate value: it tells the OS to pick a free ephemeral port (used in tests
  // and for "let the OS choose"). Only a value ABOVE 65535 (or below 0) is a configuration error.
  const port = parseIntOption(env.PORT, 4280, "PORT", { min: 0, max: 65535 });
  const maxUploadBytes = parseIntOption(env.MAX_UPLOAD_BYTES, 26214400, "MAX_UPLOAD_BYTES", { min: 1 });
  // Rate limit: 0 rpm DISABLES the limiter (min:0); burst min 1 (a 0-size bucket would block everything).
  const rateLimitRpm = parseIntOption(env.REMOTE_CODER_RATE_LIMIT_RPM, DEFAULT_RATE_LIMIT_RPM, "REMOTE_CODER_RATE_LIMIT_RPM", { min: 0 }); // prettier-ignore
  const rateLimitBurst = parseIntOption(env.REMOTE_CODER_RATE_LIMIT_BURST, DEFAULT_RATE_LIMIT_BURST, "REMOTE_CODER_RATE_LIMIT_BURST", { min: 1 }); // prettier-ignore
  // Concurrency cap: 0 DISABLES the cap (unbounded — the prior behavior, opt-out).
  const maxSessions = parseIntOption(env.REMOTE_CODER_MAX_SESSIONS, DEFAULT_MAX_SESSIONS, "REMOTE_CODER_MAX_SESSIONS", { min: 0 }); // prettier-ignore
  const cfg: ServerRuntimeConfig = {
    port,
    bindAddress: env.BIND_ADDRESS ?? "127.0.0.1",
    fsRoot: env.FS_ROOT ?? env.HOME ?? process.cwd(),
    maxUploadBytes,
    dataDir: resolveDataDir(env),
    allowedOrigins: parseAllowedOrigins(env.REMOTE_CODER_ALLOWED_ORIGINS),
    rateLimitRpm,
    rateLimitBurst,
    maxSessions,
    claude: loadConfig(env),
  };
  if (env.ACCESS_TOKEN) cfg.accessToken = env.ACCESS_TOKEN;
  if (env.TRUST_PROXY === "1" || env.TRUST_PROXY === "true") cfg.trustProxy = true;
  const publicUrl = (env.REMOTE_CODER_PUBLIC_URL ?? "").trim();
  if (publicUrl) cfg.publicUrl = publicUrl;
  return cfg;
}

export function isLoopbackAddress(address: string): boolean {
  if (address === "::1" || address === "localhost") return true;
  return /^127(?:\.\d{1,3}){3}$/.test(address);
}

/** Spec §9: refuse to serve a non-loopback bind without a token. */
export function assertConfigAllowsStart(cfg: ServerRuntimeConfig): void {
  if (!isLoopbackAddress(cfg.bindAddress) && !cfg.accessToken) {
    throw new Error(
      `refusing to start: bind address ${cfg.bindAddress} is not loopback and no ACCESS_TOKEN is set (set ACCESS_TOKEN or bind to 127.0.0.1)`,
    );
  }
}
