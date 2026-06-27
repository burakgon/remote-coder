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

/** Find absolute-looking file paths in text (for download chips). Conservative + deduped. */
export function extractFilePaths(text: string): string[] {
  // Strip URLs FIRST: a link like `https://code.claude.com` otherwise matched the path regex as
  // `//code.claude.com` and rendered a bogus "code.claude.com" download chip. Remote URLs aren't
  // downloadable through the local /fs endpoint anyway, so they're never real attachments.
  const withoutUrls = text.replace(/\b[a-z][\w+.-]*:\/\/\S+/gi, " ");
  // The extension must contain at least one LETTER. A numeric-only "extension" (`.7`, `.97` from an IP
  // fragment like `188.114.96.7/.97.7`, a port, or a version number) is never a real file — requiring a
  // letter kills those bogus chips while keeping real ones (.png, .tsx, .tar.gz, .mp4, …).
  const matches = withoutUrls.match(/\/[\w.\-/]+\.[A-Za-z0-9]*[A-Za-z][A-Za-z0-9]*/g) ?? [];
  // Drop any residual protocol-relative leftovers (a bare `//host/...`) — real file paths start with a
  // single `/`, never `//`.
  return [...new Set(matches.filter((m) => !m.startsWith("//")))];
}

/** True for a path that a browser can render inline as an image (so we preview it, not just link it). */
export function isImagePath(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(path);
}
