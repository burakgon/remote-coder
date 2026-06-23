import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

/** Host data dir for the SQLite DB + access token. Never inside the project tree by default. */
export function resolveDataDir(env: NodeJS.ProcessEnv): string {
  if (env.REMOTE_CODER_DATA_DIR) return env.REMOTE_CODER_DATA_DIR;
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, "remote-coder");
  if (env.HOME) return join(env.HOME, ".config", "remote-coder");
  return join(process.cwd(), ".remote-coder");
}

export function ensureDataDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
}

/**
 * Strong default token: 32 bytes of CSPRNG entropy (>= spec §9 baseline),
 * base64url-encoded (43 chars, no padding). Never Math.random / randomUUID.
 */
function defaultGenerate(): string {
  return randomBytes(32).toString("base64url");
}

export interface ResolveAccessTokenOptions {
  /** From ACCESS_TOKEN; when set it wins and is not persisted. */
  configured?: string;
  dataDir: string;
  /** Injectable generator for tests. Defaults to a 32-byte base64url CSPRNG token. */
  generate?: () => string;
}

/**
 * Spec §9: a long random secret generated on first run (printed once, stored).
 * Precedence: explicit ACCESS_TOKEN > persisted token file > freshly generated.
 *
 * A configured (env) token is used verbatim and never written to disk. A
 * generated token is persisted to `<dataDir>/token` with mode 0600 so other
 * users on the host cannot read it; `generated: true` lets the caller print it
 * once with the access URL.
 */
export function resolveAccessToken(opts: ResolveAccessTokenOptions): { token: string; generated: boolean } {
  if (opts.configured) return { token: opts.configured, generated: false };

  const tokenPath = join(opts.dataDir, "token");
  try {
    const existing = readFileSync(tokenPath, "utf8").trim();
    if (existing) return { token: existing, generated: false };
  } catch {
    // no token file yet — fall through to generation
  }

  const token = (opts.generate ?? defaultGenerate)();
  ensureDataDir(opts.dataDir);
  // `mode` is honored only when CREATING a file; overwriting an existing path
  // (e.g. a pre-existing empty `token` file) leaves its old, possibly
  // world-readable mode intact. chmodSync unconditionally enforces 0600 so a
  // freshly generated secret can never land in a too-permissive file.
  writeFileSync(tokenPath, token + "\n", { mode: 0o600 });
  chmodSync(tokenPath, 0o600);
  return { token, generated: true };
}
