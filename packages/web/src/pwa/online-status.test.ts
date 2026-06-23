import { afterEach, describe, expect, it, vi } from "vitest";
import { subscribeOnline } from "./online-status";

afterEach(() => vi.restoreAllMocks());

describe("subscribeOnline", () => {
  it("fires the callback on online/offline events and unsubscribes", () => {
    const cb = vi.fn();
    const off = subscribeOnline(cb);
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("online"));
    expect(cb).toHaveBeenCalledWith(false);
    expect(cb).toHaveBeenCalledWith(true);
    off();
    cb.mockClear();
    window.dispatchEvent(new Event("offline"));
    expect(cb).not.toHaveBeenCalled();
  });
});
