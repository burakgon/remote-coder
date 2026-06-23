import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import webpush from "web-push";
import { ensureDataDir } from "./data-dir.js";

export interface VapidKeys {
  /** URL-safe base64 public key — safe to send to the browser for the push subscription. */
  publicKey: string;
  /** URL-safe base64 private key — NEVER leaves the server (signs pushes). */
  privateKey: string;
}

export interface ResolveVapidKeysOptions {
  dataDir: string;
  /** Injectable generator for tests. Defaults to web-push's NIST P-256 generator. */
  generate?: () => VapidKeys;
}

function defaultGenerate(): VapidKeys {
  const { publicKey, privateKey } = webpush.generateVAPIDKeys();
  return { publicKey, privateKey };
}

/**
 * Generate the VAPID keypair on first run and persist it to `<dataDir>/vapid.json` (mode 0600 — the
 * private key is a server secret). On subsequent runs the persisted pair is reused so existing
 * browser subscriptions stay valid (rotating the key would invalidate every subscription).
 */
export function resolveVapidKeys(opts: ResolveVapidKeysOptions): VapidKeys {
  const path = join(opts.dataDir, "vapid.json");
  try {
    const existing = JSON.parse(readFileSync(path, "utf8")) as Partial<VapidKeys>;
    if (typeof existing.publicKey === "string" && typeof existing.privateKey === "string") {
      return { publicKey: existing.publicKey, privateKey: existing.privateKey };
    }
  } catch {
    // no vapid.json yet (or corrupt) — generate + persist below
  }
  const keys = (opts.generate ?? defaultGenerate)();
  ensureDataDir(opts.dataDir);
  // mode is honored only on CREATE; chmodSync unconditionally enforces 0600 even if the path existed.
  writeFileSync(path, JSON.stringify(keys), { mode: 0o600 });
  chmodSync(path, 0o600);
  return keys;
}
