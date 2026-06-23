// Screenshots the static mockup for design sign-off. Uses Playwright's bundled Chromium.
// Run: node packages/web/scripts/screenshot.mjs  (after `pnpm -C packages/web build`)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, "..", "dist");
const outDir = join(__dirname, "..", "..", "..", "docs", "design");
mkdirSync(outDir, { recursive: true });

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
};

const server = createServer(async (req, res) => {
  try {
    const urlPath = (req.url ?? "/").split("?")[0];
    const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\//, "");
    const file = join(distDir, rel);
    const data = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    // SPA fallback to index.html
    try {
      const data = await readFile(join(distDir, "index.html"));
      res.writeHead(200, { "content-type": "text/html" });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  }
});

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const { port } = server.address();
const base = `http://127.0.0.1:${port}/`;

// Playwright is invoked via its package; if unavailable, the executor may swap in
// the chrome-devtools MCP take_screenshot against `base` instead (see Step 12).
const { chromium } = await import("playwright");
const browser = await chromium.launch();
try {
  const desktop = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
  await desktop.goto(base, { waitUntil: "networkidle" });
  await desktop.screenshot({ path: join(outDir, "2026-06-23-pwa-mockup-desktop.png"), fullPage: true });

  const mobile = await browser.newPage({ viewport: { width: 390, height: 1800 }, deviceScaleFactor: 2 });
  await mobile.goto(base, { waitUntil: "networkidle" });
  await mobile.screenshot({ path: join(outDir, "2026-06-23-pwa-mockup-mobile.png"), fullPage: true });
  console.log(`Saved screenshots to ${outDir}`);
} finally {
  await browser.close();
  server.close();
}
