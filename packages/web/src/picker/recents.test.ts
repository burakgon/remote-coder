import { afterEach, describe, expect, it } from "vitest";
import { loadRecentDirs, pushRecentDir } from "./recents";

afterEach(() => localStorage.clear());

describe("recents", () => {
  it("returns an empty list when nothing is stored", () => {
    expect(loadRecentDirs()).toEqual([]);
  });
  it("stores most-recent-first, deduped", () => {
    pushRecentDir("/a");
    pushRecentDir("/b");
    pushRecentDir("/a");
    expect(loadRecentDirs()).toEqual(["/a", "/b"]);
  });
  it("caps at 8", () => {
    for (let i = 0; i < 12; i++) pushRecentDir(`/p${i}`);
    expect(loadRecentDirs()).toHaveLength(8);
    expect(loadRecentDirs()[0]).toBe("/p11");
  });
  it("tolerates a corrupt stored value", () => {
    localStorage.setItem("remote-coder.recents", "{not json");
    expect(loadRecentDirs()).toEqual([]);
  });
});
