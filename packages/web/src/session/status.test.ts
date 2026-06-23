import { describe, expect, it } from "vitest";
import { wireStateForSession } from "./status";
import type { SessionMeta } from "../types/server";

function meta(status: SessionMeta["status"]): SessionMeta {
  return { id: "s", cwd: "/p", dangerouslySkip: false, status, createdAt: 1 };
}

describe("wireStateForSession", () => {
  it("maps errored -> error and stopped -> idle regardless of live view", () => {
    expect(wireStateForSession(meta("errored"), { wireState: "streaming" })).toBe("error");
    expect(wireStateForSession(meta("stopped"), { wireState: "streaming" })).toBe("idle");
  });
  it("uses the live view wireState for a running session", () => {
    expect(wireStateForSession(meta("running"), { wireState: "awaiting" })).toBe("awaiting");
    expect(wireStateForSession(meta("running"), undefined)).toBe("idle");
  });
});
