import { afterEach, describe, expect, it } from "vitest";
import { loadToken, saveToken, clearToken, consumeTokenFromUrl } from "./token-store";

afterEach(() => {
  localStorage.clear();
  window.history.replaceState({}, "", "/");
});

describe("token-store", () => {
  it("returns undefined when nothing is stored", () => {
    expect(loadToken()).toBeUndefined();
  });
  it("round-trips a saved token", () => {
    saveToken("s3cret");
    expect(loadToken()).toBe("s3cret");
  });
  it("clears the token", () => {
    saveToken("s3cret");
    clearToken();
    expect(loadToken()).toBeUndefined();
  });
});

describe("consumeTokenFromUrl", () => {
  it("reads ?token=, persists it, and strips it from the URL", () => {
    window.history.replaceState({}, "", "/app?token=abc123");
    expect(consumeTokenFromUrl()).toBe("abc123");
    expect(loadToken()).toBe("abc123");
    expect(window.location.search).toBe("");
  });
  it("preserves other query params (e.g. ?session=) while stripping ?token=", () => {
    window.history.replaceState({}, "", "/app?token=abc123&session=s9");
    expect(consumeTokenFromUrl()).toBe("abc123");
    expect(window.location.search).toBe("?session=s9");
  });
  it("returns undefined and leaves the URL alone when there is no token param", () => {
    window.history.replaceState({}, "", "/app?session=s9");
    expect(consumeTokenFromUrl()).toBeUndefined();
    expect(window.location.search).toBe("?session=s9");
  });
});
