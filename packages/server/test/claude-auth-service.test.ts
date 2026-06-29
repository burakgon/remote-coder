import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { ClaudeAuthService, parseAuthStatus, extractLoginUrl } from "../src/index.js";

/** A fake `claude` child process: an EventEmitter with stdout/stderr streams + a recording stdin. */
function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: (s: string) => void; end: () => void };
    kill: () => void;
    writes: string[];
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.writes = [];
  child.stdin = { write: (s: string) => child.writes.push(s), end: () => {} };
  child.kill = () => {};
  return child;
}

const LOGIN_OUTPUT =
  "Opening browser to sign in…\n" +
  "If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&client_id=abc&state=xyz\n" +
  "Paste code here if prompted >";

describe("parseAuthStatus", () => {
  it("parses the claude auth status JSON", () => {
    expect(parseAuthStatus('{"loggedIn":true,"email":"a@b.com","subscriptionType":"max","orgName":"Burak"}')).toEqual({
      loggedIn: true,
      email: "a@b.com",
      subscriptionType: "max",
      orgName: "Burak",
    });
  });
  it("returns loggedIn:false on garbage", () => {
    expect(parseAuthStatus("not json")).toEqual({ loggedIn: false });
  });
});

describe("extractLoginUrl", () => {
  it("pulls the authorize URL out of the login output", () => {
    expect(extractLoginUrl(LOGIN_OUTPUT)).toBe(
      "https://claude.com/cai/oauth/authorize?code=true&client_id=abc&state=xyz",
    );
  });
  it("returns undefined when there's no URL", () => {
    expect(extractLoginUrl("Opening browser…")).toBeUndefined();
  });
});

describe("ClaudeAuthService", () => {
  it("status() resolves the parsed account", async () => {
    const child = fakeChild();
    const svc = new ClaudeAuthService({ spawn: () => child, now: () => 0 });
    const p = svc.status();
    child.stdout.emit("data", Buffer.from('{"loggedIn":true,"email":"a@b.com","subscriptionType":"max"}'));
    child.emit("close", 0);
    expect(await p).toEqual({ loggedIn: true, email: "a@b.com", subscriptionType: "max" });
  });

  it("startLogin() resolves the URL; submitCode() writes the code and resolves ok on a clean exit", async () => {
    const child = fakeChild();
    const svc = new ClaudeAuthService({ spawn: () => child, now: () => 0 });

    const startP = svc.startLogin();
    child.stdout.emit("data", Buffer.from(LOGIN_OUTPUT));
    const { loginId, url } = await startP;
    expect(url).toContain("oauth/authorize");
    expect(loginId).toBeTruthy();

    const submitP = svc.submitCode(loginId, "  MYCODE  ");
    expect(child.writes.join("")).toBe("MYCODE\n"); // trimmed + newline
    child.emit("close", 0);
    expect(await submitP).toEqual({ ok: true });
  });

  it("submitCode() with a stale/unknown loginId is rejected as not-in-progress", async () => {
    const svc = new ClaudeAuthService({ spawn: () => fakeChild(), now: () => 0 });
    const r = await svc.submitCode("nope", "CODE");
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/no sign-in/i);
  });

  it("submitCode() surfaces a failure message on a non-zero exit", async () => {
    const child = fakeChild();
    const svc = new ClaudeAuthService({ spawn: () => child, now: () => 0 });
    const startP = svc.startLogin();
    child.stdout.emit("data", Buffer.from(LOGIN_OUTPUT));
    const { loginId } = await startP;
    const submitP = svc.submitCode(loginId, "BAD");
    child.stderr.emit("data", Buffer.from("Invalid authorization code"));
    child.emit("close", 1);
    const r = await submitP;
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/invalid authorization code/i);
  });

  it("startLogin() rejects if the child exits before printing a URL", async () => {
    const child = fakeChild();
    const svc = new ClaudeAuthService({ spawn: () => child, now: () => 0 });
    const startP = svc.startLogin();
    child.emit("close", 1);
    await expect(startP).rejects.toThrow();
  });
});
