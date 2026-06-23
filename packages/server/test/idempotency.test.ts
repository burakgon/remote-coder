import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { openIdempotencyStore } from "../src/index.js";
import type { IdempotencyStore } from "../src/index.js";

let dir: string;
let store: IdempotencyStore;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "rc-idem-"));
  store = openIdempotencyStore({ dbPath: join(dir, "idem.db"), ttlMs: 1000 });
});
afterEach(async () => {
  store.close();
  await rm(dir, { recursive: true, force: true });
});

test("a remembered key returns its sessionId within the TTL", () => {
  store.remember("key-1", "sess-1", 0);
  expect(store.lookup("key-1", 500)).toBe("sess-1");
});

test("an unknown key returns undefined", () => {
  expect(store.lookup("nope", 0)).toBeUndefined();
});

test("a key past its TTL is treated as absent", () => {
  store.remember("key-1", "sess-1", 0);
  expect(store.lookup("key-1", 1001)).toBeUndefined();
});
