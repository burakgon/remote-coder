import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { resolveVapidKeys } from "../src/index.js";
import type { VapidKeys } from "../src/index.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "rc-vapid-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("generates + persists a keypair on first run", async () => {
  const keys = resolveVapidKeys({ dataDir: dir });
  expect(typeof keys.publicKey).toBe("string");
  expect(typeof keys.privateKey).toBe("string");
  expect(keys.publicKey.length).toBeGreaterThan(40);
  // Persisted to <dataDir>/vapid.json with 0600.
  const raw = await readFile(join(dir, "vapid.json"), "utf8");
  expect(JSON.parse(raw)).toEqual(keys);
  const mode = (await stat(join(dir, "vapid.json"))).mode & 0o777;
  expect(mode).toBe(0o600);
});

test("reuses the persisted keypair on a second run (does not regenerate)", () => {
  const a = resolveVapidKeys({ dataDir: dir });
  const b = resolveVapidKeys({ dataDir: dir });
  expect(b).toEqual(a);
});

test("uses an injected generator when provided (deterministic for tests)", () => {
  const fixed: VapidKeys = { publicKey: "PUB", privateKey: "PRIV" };
  const keys = resolveVapidKeys({ dataDir: dir, generate: () => fixed });
  expect(keys).toEqual(fixed);
});

test("default generator yields a real NIST P-256 keypair (public != private)", () => {
  const keys = resolveVapidKeys({ dataDir: dir });
  // web-push uses an EC prime256v1 keypair: a 65-byte uncompressed public point
  // (~87 base64url chars) and a 32-byte private scalar (~43 base64url chars).
  expect(keys.privateKey.length).toBeGreaterThan(40);
  expect(keys.publicKey).not.toEqual(keys.privateKey);
});

test("never logs the private key while resolving", () => {
  const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => {}),
  );
  try {
    const keys = resolveVapidKeys({ dataDir: dir });
    resolveVapidKeys({ dataDir: dir }); // second (reuse) path too
    for (const spy of spies) {
      for (const call of spy.mock.calls) {
        const line = call.map(String).join(" ");
        expect(line).not.toContain(keys.privateKey);
      }
    }
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
});
