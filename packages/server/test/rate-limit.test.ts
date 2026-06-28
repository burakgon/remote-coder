import { expect, test } from "vitest";
import { RateLimiter } from "../src/index.js";

test("under-limit requests all pass", () => {
  const t = 0;
  const rl = new RateLimiter({ capacity: 10, windowMs: 1000, burst: 5, now: () => t });
  for (let i = 0; i < 5; i++) {
    expect(rl.take("ip-a").allowed).toBe(true);
  }
});

test("a burst over the bucket size gets 429 with a positive Retry-After", () => {
  const t = 0;
  const rl = new RateLimiter({ capacity: 60, windowMs: 60_000, burst: 3, now: () => t });
  expect(rl.take("ip-a").allowed).toBe(true);
  expect(rl.take("ip-a").allowed).toBe(true);
  expect(rl.take("ip-a").allowed).toBe(true);
  const denied = rl.take("ip-a"); // 4th in the same instant → bucket empty
  expect(denied.allowed).toBe(false);
  expect(denied.retryAfterSeconds).toBeGreaterThanOrEqual(1);
});

test("the limiter is keyed PER CLIENT (one client's flood doesn't affect another)", () => {
  const t = 0;
  const rl = new RateLimiter({ capacity: 60, windowMs: 60_000, burst: 2, now: () => t });
  expect(rl.take("ip-a").allowed).toBe(true);
  expect(rl.take("ip-a").allowed).toBe(true);
  expect(rl.take("ip-a").allowed).toBe(false); // ip-a exhausted
  // A different client is unaffected.
  expect(rl.take("ip-b").allowed).toBe(true);
  expect(rl.take("ip-b").allowed).toBe(true);
});

test("tokens refill over time (sustained rate restores capacity)", () => {
  let t = 0;
  const rl = new RateLimiter({ capacity: 60, windowMs: 60_000, burst: 1, now: () => t });
  expect(rl.take("ip-a").allowed).toBe(true); // spend the only token
  expect(rl.take("ip-a").allowed).toBe(false); // empty
  // 60 tokens / 60_000ms = 1 token/sec; advance 1s → one token back.
  t += 1000;
  expect(rl.take("ip-a").allowed).toBe(true);
});

test("a legit poll cadence (every ~6s) never trips the default-shaped limit", () => {
  let t = 0;
  // Mirror the production default shape: 600 rpm sustained, burst 120.
  const rl = new RateLimiter({ capacity: 600, windowMs: 60_000, burst: 120, now: () => t });
  // The app polls /sessions + /version periodically; simulate 100 polls 6s apart — all must pass.
  for (let i = 0; i < 100; i++) {
    expect(rl.take("ip-a").allowed).toBe(true);
    t += 6000;
  }
});

test("enabled:false disables the limiter entirely (always allowed)", () => {
  const t = 0;
  const rl = new RateLimiter({ capacity: 1, windowMs: 60_000, burst: 1, enabled: false, now: () => t });
  for (let i = 0; i < 100; i++) {
    expect(rl.take("ip-a").allowed).toBe(true);
  }
});

test("fully-refilled buckets are swept so the client map stays bounded", () => {
  let t = 0;
  const rl = new RateLimiter({ capacity: 60, windowMs: 60_000, burst: 5, now: () => t });
  rl.take("ip-a");
  expect(rl.trackedClientCount()).toBe(1);
  // Advance well past a full refill window; the next take (for a different key) sweeps the refilled ip-a.
  t += 120_000;
  rl.take("ip-b");
  // ip-a was fully refilled → swept; ip-b just took one token (not full) → retained.
  expect(rl.trackedClientCount()).toBe(1);
});
