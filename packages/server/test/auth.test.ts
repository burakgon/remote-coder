import { expect, test } from "vitest";
import { AuthGate, extractBearerToken } from "../src/index.js";

test("extractBearerToken parses the Bearer scheme case-insensitively", () => {
  expect(extractBearerToken("Bearer abc123")).toBe("abc123");
  expect(extractBearerToken("bearer abc123")).toBe("abc123");
  expect(extractBearerToken("Token abc123")).toBeUndefined();
  expect(extractBearerToken(undefined)).toBeUndefined();
  expect(extractBearerToken("Bearer")).toBeUndefined();
});

test("check() accepts the right token and rejects the wrong one", () => {
  const gate = new AuthGate({ token: "s3cret" });
  expect(gate.check("s3cret", "ip-a")).toEqual({ ok: true });
  expect(gate.check("nope", "ip-a")).toEqual({ ok: false, reason: "invalid" });
});

test("check() rejects a missing presented token as invalid", () => {
  const gate = new AuthGate({ token: "s3cret" });
  expect(gate.check(undefined, "ip-a")).toEqual({ ok: false, reason: "invalid" });
});

test("a gate with no configured token never accepts", () => {
  const gate = new AuthGate({});
  expect(gate.check("anything", "ip-a")).toEqual({ ok: false, reason: "missing-token-config" });
});

test("repeated failures lock the client out, and the lock expires", () => {
  let t = 1000;
  const gate = new AuthGate({ token: "s3cret", maxFailures: 3, lockoutMs: 5000, now: () => t });
  expect(gate.check("bad", "ip-x")).toEqual({ ok: false, reason: "invalid" });
  expect(gate.check("bad", "ip-x")).toEqual({ ok: false, reason: "invalid" });
  expect(gate.check("bad", "ip-x")).toEqual({ ok: false, reason: "invalid" }); // 3rd failure trips the lock
  // Now locked: even the CORRECT token is refused while locked.
  expect(gate.check("s3cret", "ip-x")).toEqual({ ok: false, reason: "locked" });
  // Advance past the lockout window -> allowed again.
  t += 5001;
  expect(gate.check("s3cret", "ip-x")).toEqual({ ok: true });
});

test("lockout is per-client; a success resets the failure count", () => {
  const t = 0; // never reassigned in this case (prefer-const); the other case advances the clock
  const gate = new AuthGate({ token: "s3cret", maxFailures: 2, lockoutMs: 1000, now: () => t });
  expect(gate.check("bad", "ip-1")).toEqual({ ok: false, reason: "invalid" });
  // A different client is unaffected.
  expect(gate.check("s3cret", "ip-2")).toEqual({ ok: true });
  // A success on ip-1 before it trips clears its count.
  expect(gate.check("s3cret", "ip-1")).toEqual({ ok: true });
  expect(gate.check("bad", "ip-1")).toEqual({ ok: false, reason: "invalid" });
  expect(gate.check("s3cret", "ip-1")).toEqual({ ok: true }); // still not locked (count was reset)
});
