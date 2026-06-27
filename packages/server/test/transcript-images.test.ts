import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { ImageStore } from "../src/image-store.js";
import { slimImageBlocks } from "../src/transcript-images.js";

const b64 = (data = "QUJD", media = "image/png") => ({
  type: "image",
  source: { type: "base64", media_type: media, data },
});

let dir: string;
let store: ImageStore;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "rc-slim-"));
  store = new ImageStore({ dataDir: dir });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("slimImageBlocks (content-addressed)", () => {
  test("moves a top-level base64 image into the store and replaces it with a /images/<ref> url", async () => {
    const msg = { role: "user", content: [{ type: "text", text: "hi" }, b64("aGVsbG8=")] };
    const out = (await slimImageBlocks(msg, store)) as {
      content: { type: string; source?: { type: string; url?: string; media_type?: string } }[];
    };
    expect(out).not.toBe(msg); // cloned, not mutated
    expect(out.content[0]).toEqual({ type: "text", text: "hi" });
    const src = out.content[1]!.source!;
    expect(src.type).toBe("url");
    expect(src.media_type).toBe("image/png");
    expect(src.url).toMatch(/^\/images\/[a-f0-9]{64}\.png$/);
    // the original message is untouched (still inline base64)
    expect((msg.content[1] as { source: { type: string } }).source.type).toBe("base64");
    // the bytes are actually written to the store
    const ref = src.url!.slice("/images/".length);
    const stored = await store.read(ref);
    expect(stored!.data.toString()).toBe("hello");
  });

  test("identical images dedupe to the SAME ref (content-addressed)", async () => {
    const a = (await slimImageBlocks({ content: [b64("c2FtZQ==")] }, store)) as {
      content: { source: { url: string } }[];
    };
    const b = (await slimImageBlocks({ content: [b64("c2FtZQ==")] }, store)) as {
      content: { source: { url: string } }[];
    };
    expect(a.content[0]!.source.url).toBe(b.content[0]!.source.url);
  });

  test("moves a base64 image NESTED in a tool_result too", async () => {
    const msg = {
      content: [{ type: "tool_result", tool_use_id: "t", content: [{ type: "text", text: "x" }, b64("Wg==")] }],
    };
    const out = (await slimImageBlocks(msg, store)) as {
      content: { content: { source: { type: string; url: string } }[] }[];
    };
    expect(out.content[0]!.content[1]!.source.type).toBe("url");
    expect(out.content[0]!.content[1]!.source.url).toMatch(/^\/images\/[a-f0-9]{64}\.png$/);
  });

  test("returns the SAME reference when there is no base64 image (no needless clone)", async () => {
    const msg = { role: "assistant", content: [{ type: "text", text: "hi" }] };
    expect(await slimImageBlocks(msg, store)).toBe(msg);
  });

  test("non-object / contentless messages pass through untouched", async () => {
    expect(await slimImageBlocks("hello", store)).toBe("hello");
    const plain = { role: "user", content: "plain string" };
    expect(await slimImageBlocks(plain, store)).toBe(plain);
  });

  test("an already-url image source is left as-is (idempotent on a re-slim)", async () => {
    const msg = {
      content: [{ type: "image", source: { type: "url", media_type: "image/png", url: "/images/x.png" } }],
    };
    expect(await slimImageBlocks(msg, store)).toBe(msg);
  });
});

describe("ImageStore basics", () => {
  test("save is content-addressed + idempotent; read round-trips; refs are traversal-safe", async () => {
    const ref1 = await store.save(Buffer.from("hello"), "image/png");
    const ref2 = await store.save(Buffer.from("hello"), "image/png");
    expect(ref1).toBe(ref2);
    expect(ref1).toMatch(/^[a-f0-9]{64}\.png$/);
    const got = await store.read(ref1);
    expect(got!.data.toString()).toBe("hello");
    expect(got!.mediaType).toBe("image/png");
    // the file is really on disk under the store root
    expect((await readFile(join(dir, "images", ref1))).toString()).toBe("hello");
    // malformed / traversal refs are rejected
    expect(store.isValidRef("../secret")).toBe(false);
    expect(store.isValidRef("abc/def.png")).toBe(false);
    expect(await store.read("../../etc/passwd")).toBeUndefined();
    expect(await store.read("deadbeef.png")).toBeUndefined(); // valid-looking ext but bad hash → no file
  });
});
