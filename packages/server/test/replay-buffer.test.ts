import { expect, test } from "vitest";
import { ReplayBuffer, isCriticalKind } from "../src/index.js";

test("push assigns monotonic seq starting at 1 and snapshot preserves order", () => {
  const buf = new ReplayBuffer(100);
  const a = buf.push("event", { n: 1 });
  const b = buf.push("event", { n: 2 });
  expect(a.seq).toBe(1);
  expect(b.seq).toBe(2);
  expect(buf.snapshot().map((f) => f.seq)).toEqual([1, 2]);
});

test("isCriticalKind marks permission and result critical only", () => {
  expect(isCriticalKind("permission")).toBe(true);
  expect(isCriticalKind("result")).toBe(true);
  expect(isCriticalKind("event")).toBe(false);
  expect(isCriticalKind("diagnostic")).toBe(false);
  expect(isCriticalKind("exit")).toBe(false);
});

test("over-capacity eviction drops oldest NON-critical frames only", () => {
  const buf = new ReplayBuffer(2); // capacity = 2 non-critical frames
  buf.push("event", { n: 1 }); // seq 1 (non-critical)
  buf.push("permission", { id: "p" }); // seq 2 (critical — never evicted)
  buf.push("event", { n: 2 }); // seq 3 (non-critical) -> now 2 non-critical, at capacity
  buf.push("event", { n: 3 }); // seq 4 (non-critical) -> evict oldest non-critical (seq 1)

  const seqs = buf.snapshot().map((f) => f.seq);
  expect(seqs).toContain(2); // the permission frame survives
  expect(seqs).not.toContain(1); // the oldest non-critical was evicted
  expect(seqs).toEqual([2, 3, 4]);
});

test("a permission frame is NEVER evicted even under heavy non-critical churn", () => {
  const buf = new ReplayBuffer(1);
  buf.push("permission", { id: "keep-me" }); // critical
  for (let i = 0; i < 50; i++) buf.push("event", { i });
  const perms = buf.snapshot().filter((f) => f.kind === "permission");
  expect(perms).toHaveLength(1);
  expect((perms[0].payload as { id: string }).id).toBe("keep-me");
});

test("since(seq) returns only frames after the given seq", () => {
  const buf = new ReplayBuffer(100);
  buf.push("event", { n: 1 });
  buf.push("result", { n: 2 });
  buf.push("event", { n: 3 });
  expect(buf.since(1).map((f) => f.seq)).toEqual([2, 3]);
  expect(buf.since(3)).toEqual([]);
});
