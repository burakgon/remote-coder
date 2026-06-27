import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Content-addressed image store. Images uploaded from the PWA (and images backfilled out of a Claude
 * transcript on reopen) are written ONCE to `<dataDir>/images/<sha256>.<ext>` and referenced by that
 * ref everywhere we control — the WS send carries a ref (not base64), the chat renders `/images/<ref>`,
 * and a reopen ships `/images/<ref>` instead of inline base64. Content addressing means identical images
 * dedupe automatically (compact) and a ref is immutable (cacheable forever). The ONLY place base64 still
 * exists is the bytes handed to the Claude CLI for vision (and Claude's own transcript) — unavoidable.
 */

// ext ⇄ media type for the image kinds the composer accepts (plus svg/bmp/avif a transcript might carry).
const EXT_BY_MEDIA: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
  "image/avif": "avif",
};
const MEDIA_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  avif: "image/avif",
};

// A ref is exactly a sha256 hex digest + a short alphanumeric extension — no slashes or `..`, so a
// client-supplied ref can never traverse outside the store root (join(root, ref) stays in root).
const REF_RE = /^[a-f0-9]{64}\.[a-z0-9]+$/;

export interface ImageStoreOptions {
  /** The server data dir; images live under `<dataDir>/images`. */
  dataDir: string;
}

export class ImageStore {
  readonly root: string;

  constructor(opts: ImageStoreOptions) {
    // The real server always passes a data dir; fall back to a temp location so a misconfigured/legacy
    // config (some tests omit dataDir) constructs without throwing rather than crashing server startup.
    const base = opts.dataDir && opts.dataDir.length > 0 ? opts.dataDir : join(tmpdir(), "remote-coder");
    this.root = join(base, "images");
  }

  private extFor(mediaType: string): string {
    return EXT_BY_MEDIA[mediaType] ?? "bin";
  }

  /** True for a well-formed `<sha256>.<ext>` ref (path-traversal safe). */
  isValidRef(ref: string): boolean {
    return REF_RE.test(ref);
  }

  /** The media type implied by a ref's extension (octet-stream for an unknown/missing ext). */
  mediaTypeFor(ref: string): string {
    const ext = ref.slice(ref.lastIndexOf(".") + 1).toLowerCase();
    return MEDIA_BY_EXT[ext] ?? "application/octet-stream";
  }

  /**
   * Store raw image bytes, returning the content ref `<sha256>.<ext>`. Idempotent: a byte-identical
   * image dedupes to the same ref and is written only once (so re-uploading / backfilling is cheap).
   */
  async save(data: Buffer, mediaType: string): Promise<string> {
    const sha = createHash("sha256").update(data).digest("hex");
    const ref = `${sha}.${this.extFor(mediaType)}`;
    await mkdir(this.root, { recursive: true });
    const path = join(this.root, ref);
    try {
      await stat(path); // already stored (content-addressed) → nothing to write
    } catch {
      await writeFile(path, data);
    }
    return ref;
  }

  /** Store base64 bytes (used to backfill a transcript's inline image into the store on reopen). */
  async saveBase64(base64: string, mediaType: string): Promise<string> {
    return this.save(Buffer.from(base64, "base64"), mediaType);
  }

  /** Read a stored image by ref, or undefined for a malformed ref / missing file. */
  async read(ref: string): Promise<{ data: Buffer; mediaType: string } | undefined> {
    if (!this.isValidRef(ref)) return undefined;
    try {
      const data = await readFile(join(this.root, ref));
      return { data, mediaType: this.mediaTypeFor(ref) };
    } catch {
      return undefined;
    }
  }
}
