import { describe, expect, it } from "vitest";
import { validateImage, fileToBase64, MAX_IMAGE_BYTES } from "./image-util";

describe("validateImage", () => {
  it("accepts a small png", () => {
    expect(validateImage({ type: "image/png", size: 1024 })).toBeNull();
  });
  it("rejects an unsupported type", () => {
    expect(validateImage({ type: "image/bmp", size: 1024 })).toMatch(/unsupported/i);
  });
  it("rejects an oversized image", () => {
    expect(validateImage({ type: "image/png", size: MAX_IMAGE_BYTES + 1 })).toMatch(/5 ?MB|too large/i);
  });
});

describe("fileToBase64", () => {
  it("base64-encodes a blob without the data-url prefix", async () => {
    const blob = new Blob(["hello"], { type: "text/plain" });
    const b64 = await fileToBase64(blob);
    expect(b64).toBe(btoa("hello"));
  });
});
