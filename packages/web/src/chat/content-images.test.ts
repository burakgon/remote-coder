import { describe, expect, it } from "vitest";
import { imageBlockSrc } from "./content-images";

describe("imageBlockSrc", () => {
  it("builds a data url from a base64 image block", () => {
    expect(imageBlockSrc({ type: "image", source: { type: "base64", media_type: "image/png", data: "QUJD" } })).toBe(
      "data:image/png;base64,QUJD",
    );
  });

  it("resolves a file-backed url source via the resolver (token-bearing absolute URL)", () => {
    const block = {
      type: "image",
      source: { type: "url", media_type: "image/png", url: "/images/abc123.png" },
    } as const;
    const resolveUrl = (u: string) => `https://host${u}?token=secret`;
    expect(imageBlockSrc(block, resolveUrl)).toBe("https://host/images/abc123.png?token=secret");
  });

  it("falls back to the bare relative url when no resolver is given", () => {
    const block = { type: "image", source: { type: "url", url: "/images/abc123.png" } } as const;
    expect(imageBlockSrc(block)).toBe("/images/abc123.png");
  });
});

// NOTE: extractFilePaths/isImagePath were removed — the app no longer scrapes file paths out of prose
// (it produced bogus chips/previews). A file or image is shown only when the model deliberately sends it.
