import type { ContentBlock } from "../types/server";

/**
 * The `src` for an image block. A `base64` source becomes a self-contained data URI. A `url` source is
 * a file-backed image ref (a relative path like `/images/<ref>`, shipped by the optimistic bubble and a
 * reopen); `resolveUrl` turns it into the absolute, token-bearing URL (api.mediaUrl) so the <img> GET
 * passes the auth gate. Without a resolver the bare relative path is returned (works same-origin), so
 * the function is still usable in tests/seeds.
 */
export function imageBlockSrc(
  block: Extract<ContentBlock, { type: "image" }>,
  resolveUrl?: (url: string) => string,
): string {
  const src = block.source;
  if (src.type === "url") return resolveUrl ? resolveUrl(src.url) : src.url;
  return `data:${src.media_type};base64,${src.data}`;
}
