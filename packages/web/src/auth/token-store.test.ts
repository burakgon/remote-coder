import { afterEach, describe, expect, it } from "vitest";
import { loadToken, saveToken, clearToken } from "./token-store";

afterEach(() => localStorage.clear());

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
