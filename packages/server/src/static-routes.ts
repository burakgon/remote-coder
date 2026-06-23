import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";

/**
 * Server-side mirror of the web SW's `apiNavigationDenylist` (packages/web/src/pwa/sw-exclusions.ts),
 * EXTENDED with /health, /push and the /ws suffix. A request whose path matches one of these is a
 * live API/WS/health/push route — the SPA navigation fallback must NOT serve index.html for it (it
 * must hit the real handler), and the auth gate must NOT treat it as a public static asset.
 *
 * SYNC INVARIANT: this denylist (and `isPublicForRequest` below) decides which requests skip the
 * token gate, while Fastify's find-my-way router decides which handler a request reaches. The two
 * MUST agree on path normalization, or a request can look public to the gate yet reach a protected
 * handler (an auth bypass). We gate on the DECODED path (`pathForGate`) to match the router's
 * percent-decoding, and we reject encoded separators (`hasEncodedSep`). If Fastify is ever
 * configured with `caseSensitive:false` or `ignoreDuplicateSlashes:true`, this gate must apply the
 * SAME case/slash normalization first, or those options will silently reopen the bypass.
 */
export const API_PATH_DENYLIST: RegExp[] = [/^\/sessions/, /^\/fs/, /^\/health/, /^\/push/, /\/ws$/];

/**
 * Normalize a raw request URL to the path the FASTIFY ROUTER will route, for the auth gate.
 * find-my-way routes the percent-DECODED path, so we must gate on the decoded path too — otherwise
 * `GET /%73essions` (`%73`=`s`) looks public to a raw-path gate but routes to `/sessions`.
 * A malformed escape (decodeURIComponent throws) falls back to the raw path (still gated by the
 * caller's encoded-separator check), never crashing the gate.
 */
export function pathForGate(rawUrl: string): string {
  const raw = rawUrl.split("?")[0] ?? "/";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * True if the RAW (pre-decode) path carries an encoded slash or backslash (`%2f`/`%2F`/`%5c`/`%5C`).
 * find-my-way's handling of encoded slashes can desync from a single `decodeURIComponent`, and any
 * request that needs an encoded separator to look public is inherently suspicious — so we treat such
 * requests as NON-public (gated) regardless of what they decode to.
 */
export function hasEncodedSep(rawUrl: string): boolean {
  const raw = rawUrl.split("?")[0] ?? "/";
  return /%2f|%5c/i.test(raw);
}

/**
 * The auth-boundary decision for a real request: a request is public (skips the token gate / may get
 * the SPA shell) IFF it has no encoded separator AND its decoded path is a public static/shell path.
 * Both the preHandler bypass (transport.ts) and the SPA `setNotFoundHandler` MUST use this, so the
 * gate and the router agree on what is reachable.
 */
export function isPublicForRequest(rawUrl: string): boolean {
  return !hasEncodedSep(rawUrl) && isPublicPath(pathForGate(rawUrl));
}

/**
 * True for the PUBLIC static shell (HTML/JS/CSS/icons/manifest/sw + any SPA route) — served WITHOUT
 * a token so the login screen can load and THEN authenticate. A path is public iff it is NOT an
 * API/WS/health/push route. (The served bundle carries no secret: the token lives only in the
 * browser localStorage.)
 *
 * INVARIANT: a built shell asset must NEVER live at a path starting `/sessions`, `/fs`, `/ws`,
 * `/health`, or `/push`. This holds for the Vite build (assets are emitted under `/assets/`, plus
 * root `/index.html`, `/icon-*.svg`, `/manifest.webmanifest`, `/sw.js`) — none collide with the
 * denylist. If a future asset were ever emitted under one of those prefixes, this default-deny would
 * wrongly 401 a real asset to an unauthenticated shell load (the shell would fail to boot). Keep the
 * Vite output prefixes clear of the denylist, or special-case the asset path here.
 */
export function isPublicPath(path: string): boolean {
  return !API_PATH_DENYLIST.some((re) => re.test(path));
}

export interface RegisterStaticOptions {
  /** Absolute path to the built PWA (packages/web/dist). */
  webDir: string;
}

/**
 * Serve the built PWA at `/` with an SPA fallback: any GET navigation that is NOT a static file and
 * NOT an API/WS/health/push route returns index.html, so client-side routes (e.g. /login) work on a
 * hard refresh. The fallback is scoped by `isPublicPath` so an unknown /sessions/... never silently
 * resolves to the shell (it must 404/401 from the real handlers).
 */
export function registerStatic(app: FastifyInstance, opts: RegisterStaticOptions): void {
  app.register(fastifyStatic, { root: opts.webDir, wildcard: false });

  // SPA fallback for navigations to non-file public paths (e.g. /login, /sessions-ui deep links that
  // are CLIENT routes). `setNotFoundHandler` runs only when no route/file matched.
  app.setNotFoundHandler((request, reply) => {
    if (request.method === "GET" && isPublicForRequest(request.url)) {
      // sendFile is added to reply by @fastify/static.
      return (reply as unknown as { sendFile: (f: string) => unknown }).sendFile("index.html");
    }
    reply.code(404).send({ error: "not found" });
  });
}
