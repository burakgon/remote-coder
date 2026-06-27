import { describe, expect, it } from "vitest";
import { imageBlockSrc, extractFilePaths } from "./content-images";

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

describe("extractFilePaths", () => {
  it("finds absolute file paths in text", () => {
    const paths = extractFilePaths("File created successfully at: /private/tmp/rc-spike/spike.txt now");
    expect(paths).toContain("/private/tmp/rc-spike/spike.txt");
  });
  it("dedupes and ignores non-paths", () => {
    expect(extractFilePaths("no paths here")).toEqual([]);
    const dup = extractFilePaths("/a/b.txt and again /a/b.txt");
    expect(dup).toEqual(["/a/b.txt"]);
  });
  it("does NOT turn URLs / domains into file-download chips", () => {
    // A link like https://code.claude.com used to match the path regex as `//code.claude.com`.
    expect(extractFilePaths("Sources:\n- Docs — https://code.claude.com\n- https://claudelog.com/x")).toEqual([]);
    expect(extractFilePaths("see http://example.com/page.html")).toEqual([]);
    // A real file path mentioned alongside a URL is still picked up.
    expect(extractFilePaths("edited /src/app.ts — see https://code.claude.com")).toEqual(["/src/app.ts"]);
  });
  it("does NOT turn an IP fragment / numeric-only extension into a download chip", () => {
    // The reported bug: "Cloudflare ( 188.114.96.7/.97.7 )" produced a bogus `.97.7` chip — the `/.97.7`
    // matched as a path with a numeric ".7" extension. A real extension always has a letter.
    expect(extractFilePaths("Cloudflare ( 188.114.96.7/.97.7 ) bridges to 127.0.0.1:20241")).toEqual([]);
    expect(extractFilePaths("ratio 3/4.5 and version /1.2.3")).toEqual([]);
    // Real files (letter-bearing extensions) still chip, including a multi-dot name.
    expect(extractFilePaths("see /tmp/out.7z and /a/b/archive.tar.gz")).toEqual(["/tmp/out.7z", "/a/b/archive.tar.gz"]);
  });
});
