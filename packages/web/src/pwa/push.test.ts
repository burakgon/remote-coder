import { describe, expect, it } from "vitest";
import { urlBase64ToUint8Array, enablePush } from "./push";

describe("urlBase64ToUint8Array", () => {
  it("decodes a url-safe base64 VAPID key to bytes", () => {
    // "AQID" is base64 for [1,2,3]; url-safe + no padding handled internally.
    const bytes = urlBase64ToUint8Array("AQID");
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
  });
  it("handles url-safe chars (- and _) and missing padding", () => {
    // Should not throw on a realistic key alphabet.
    expect(() => urlBase64ToUint8Array("BNc-_key0123ABCdef")).not.toThrow();
  });
});

describe("enablePush", () => {
  it("returns 'unsupported' when the browser lacks Push/ServiceWorker", async () => {
    const api = { getVapidPublicKey: async () => "AQID", subscribePush: async () => undefined };
    // jsdom has no real serviceWorker/PushManager → unsupported.
    const result = await enablePush(api);
    expect(result).toBe("unsupported");
  });
});
