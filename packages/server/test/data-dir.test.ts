import { mkdtemp, rm, readFile, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { resolveDataDir, ensureDataDir, resolveAccessToken } from "../src/index.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "rc-data-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("resolveDataDir prefers REMOTE_CODER_DATA_DIR, then XDG, then HOME/.config", () => {
  expect(resolveDataDir({ REMOTE_CODER_DATA_DIR: "/explicit" } as NodeJS.ProcessEnv)).toBe("/explicit");
  expect(resolveDataDir({ XDG_CONFIG_HOME: "/xdg" } as NodeJS.ProcessEnv)).toBe("/xdg/remote-coder");
  expect(resolveDataDir({ HOME: "/home/u" } as NodeJS.ProcessEnv)).toBe("/home/u/.config/remote-coder");
});

test("ensureDataDir creates the directory (idempotent)", async () => {
  const target = join(dir, "nested", "remote-coder");
  ensureDataDir(target);
  ensureDataDir(target); // no throw on re-run
  expect((await stat(target)).isDirectory()).toBe(true);
});

test("a configured token is used verbatim and NOT persisted (generated=false)", async () => {
  const r = resolveAccessToken({ configured: "env-token", dataDir: dir });
  expect(r).toEqual({ token: "env-token", generated: false });
  await expect(readFile(join(dir, "token"), "utf8")).rejects.toThrow(); // nothing written
});

test("no configured + no file -> generates, persists with mode 0600, generated=true", async () => {
  const r = resolveAccessToken({ dataDir: dir, generate: () => "GENERATED" });
  expect(r.generated).toBe(true);
  expect(r.token).toBe("GENERATED");
  const persisted = (await readFile(join(dir, "token"), "utf8")).trim();
  expect(persisted).toBe("GENERATED");
  const mode = (await stat(join(dir, "token"))).mode & 0o777;
  expect(mode).toBe(0o600);
});

test("an existing token file is reused (generated=false, no regeneration)", async () => {
  await writeFile(join(dir, "token"), "STORED\n", { mode: 0o600 });
  const r = resolveAccessToken({ dataDir: dir, generate: () => "SHOULD-NOT-RUN" });
  expect(r).toEqual({ token: "STORED", generated: false });
});

test("the default generator produces strong (>=32 byte) base64url randomness, distinct per call", async () => {
  const a = resolveAccessToken({ dataDir: dir });
  await rm(join(dir, "token"), { force: true });
  const b = resolveAccessToken({ dataDir: dir });
  // 32 random bytes -> 43 base64url chars (no padding).
  expect(a.token).toMatch(/^[A-Za-z0-9_-]{43,}$/);
  expect(b.token).toMatch(/^[A-Za-z0-9_-]{43,}$/);
  expect(a.token).not.toBe(b.token);
});
