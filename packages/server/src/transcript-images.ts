import type { ImageStore } from "./image-store.js";

/**
 * LAZY transcript images. A reopen ships the on-disk transcript as history (session-hub.getHistory).
 * A user-uploaded screenshot is stored INLINE in Claude's transcript as a base64 image block, so a long
 * chat shipped multiple MB of base64 over the tunnel on every reopen (15–20s on a phone). `slimImageBlocks`
 * moves each base64 image into the content-addressed {@link ImageStore} (deduped, written once) and
 * replaces its source with a tiny `{type:"url"}` ref to `/images/<ref>`, so the history payload is small
 * and the bytes load lazily, file-served, only when an <img> renders. This also backfills legacy
 * transcripts (images sent before the store existed) into the store on first reopen.
 */

interface Base64ImageBlock {
  type: "image";
  source: { type: "base64"; media_type: string; data: string };
}

/** True for a well-formed inline base64 image block ({type:"image", source:{type:"base64",...}}). */
function isBase64Image(block: unknown): block is Base64ImageBlock {
  if (!block || typeof block !== "object") return false;
  const b = block as { type?: unknown; source?: unknown };
  if (b.type !== "image" || !b.source || typeof b.source !== "object") return false;
  const s = b.source as { type?: unknown; media_type?: unknown; data?: unknown };
  return s.type === "base64" && typeof s.media_type === "string" && typeof s.data === "string";
}

/**
 * Recursively move every base64 image in a content array into the store and replace it with a url ref.
 * Returns the same array reference (and `changed:false`) when nothing matched, so an image-free turn is
 * never cloned. Recurses into any block carrying its own `content` array (a tool_result). On a store
 * failure for a given image the inline base64 is KEPT (fidelity over size) so the image never breaks.
 */
async function transformContent(
  content: unknown[],
  store: ImageStore,
): Promise<{ content: unknown[]; changed: boolean }> {
  let changed = false;
  const out = await Promise.all(
    content.map(async (block) => {
      if (isBase64Image(block)) {
        try {
          const ref = await store.saveBase64(block.source.data, block.source.media_type);
          changed = true;
          return { type: "image", source: { type: "url", media_type: block.source.media_type, url: `/images/${ref}` } };
        } catch {
          return block; // keep inline base64 if the store write failed — never break the image
        }
      }
      if (block && typeof block === "object" && Array.isArray((block as { content?: unknown }).content)) {
        const nested = await transformContent((block as { content: unknown[] }).content, store);
        if (nested.changed) {
          changed = true;
          return { ...(block as object), content: nested.content };
        }
      }
      return block;
    }),
  );
  return { content: changed ? out : content, changed };
}

/**
 * Return `message` with every base64 image source moved into the store and replaced by a `/images/<ref>`
 * url ref, or the SAME message reference when it carries no base64 image (so non-image turns aren't
 * cloned). Never mutates the input (clones only the changed nodes).
 */
export async function slimImageBlocks(message: unknown, store: ImageStore): Promise<unknown> {
  if (!message || typeof message !== "object") return message;
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return message;
  const result = await transformContent(content, store);
  return result.changed ? { ...(message as object), content: result.content } : message;
}
