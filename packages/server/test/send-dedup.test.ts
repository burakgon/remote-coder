import { expect, test } from "vitest";
import { createSendDedup } from "../src/index.js";

test("same msgId within the TTL is a duplicate (delivered at most once)", () => {
  const d = createSendDedup({ ttlMs: 1000, now: () => 0 });
  expect(d.firstSeen("s1", "m1", 0)).toBe(true); // first → forward
  expect(d.firstSeen("s1", "m1", 100)).toBe(false); // resend within TTL → drop
  expect(d.firstSeen("s1", "m1", 999)).toBe(false); // still within TTL → drop
});

test("different msgIds are independent (both delivered)", () => {
  const d = createSendDedup({ ttlMs: 1000 });
  expect(d.firstSeen("s1", "m1", 0)).toBe(true);
  expect(d.firstSeen("s1", "m2", 0)).toBe(true);
});

test("the same msgId is allowed again after the TTL elapses", () => {
  const d = createSendDedup({ ttlMs: 1000 });
  expect(d.firstSeen("s1", "m1", 0)).toBe(true);
  expect(d.firstSeen("s1", "m1", 500)).toBe(false); // within window
  expect(d.firstSeen("s1", "m1", 1001)).toBe(true); // past the window → a NEW action reusing an old id is fine
});

test("dedup is per-session: the same msgId in two sessions both forward", () => {
  const d = createSendDedup({ ttlMs: 1000 });
  expect(d.firstSeen("s1", "shared", 0)).toBe(true);
  expect(d.firstSeen("s2", "shared", 0)).toBe(true);
});

test("a blank/absent msgId is never deduped (older clients keep current behavior)", () => {
  const d = createSendDedup({ ttlMs: 1000 });
  expect(d.firstSeen("s1", undefined, 0)).toBe(true);
  expect(d.firstSeen("s1", undefined, 0)).toBe(true);
  expect(d.firstSeen("s1", "", 0)).toBe(true);
  expect(d.firstSeen("s1", "", 0)).toBe(true);
});

test("forget clears a session's memory (a prior msgId forwards again)", () => {
  const d = createSendDedup({ ttlMs: 1000 });
  expect(d.firstSeen("s1", "m1", 0)).toBe(true);
  expect(d.firstSeen("s1", "m1", 1)).toBe(false);
  d.forget("s1");
  expect(d.firstSeen("s1", "m1", 2)).toBe(true); // memory gone → treated as first again
});

test("bounded per session: oldest ids are evicted past the cap", () => {
  const d = createSendDedup({ ttlMs: 1_000_000, maxPerSession: 2, now: () => 0 });
  expect(d.firstSeen("s1", "a", 0)).toBe(true);
  expect(d.firstSeen("s1", "b", 0)).toBe(true);
  expect(d.firstSeen("s1", "c", 0)).toBe(true); // evicts "a" (oldest)
  // "a" was evicted → it forwards again; "b"/"c" are still remembered → dropped.
  expect(d.firstSeen("s1", "a", 0)).toBe(true);
  expect(d.firstSeen("s1", "c", 0)).toBe(false);
});
