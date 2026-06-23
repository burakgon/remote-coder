// Real-component PWA screenshots for design sign-off. Serves the built screenshot harness
// (dist-shot/, produced by `vite build --config vite.screenshot.config.ts`) and captures the REAL
// app shell + chat at mobile (390px) and desktop (1280px) into docs/design/.
//
// Run: pnpm -C packages/web build:shot && node packages/web/scripts/app-screenshot.mjs
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, "..", "dist-shot");
const outDir = join(__dirname, "..", "..", "..", "docs", "design");
mkdirSync(outDir, { recursive: true });

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".woff": "font/woff", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };

const server = createServer(async (req, res) => {
  try {
    const urlPath = (req.url ?? "/").split("?")[0];
    const rel = urlPath === "/" ? "screenshot.html" : urlPath.replace(/^\//, "");
    const file = join(distDir, rel);
    const data = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    try {
      const data = await readFile(join(distDir, "screenshot.html"));
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

// Wait until the harness has mounted (the chat header text is present) and all @font-face files
// have finished loading, so we never capture a fallback-font frame.
async function ready(page) {
  // The chat header (always visible on both viewports) renders the active session basename.
  await page.waitForSelector("header strong.display", { state: "visible", timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
  // One frame of settle for layout/paint.
  await page.waitForTimeout(200);
}

const { chromium } = await import("playwright");
const browser = await chromium.launch();
try {
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await mobile.goto(base, { waitUntil: "networkidle" });
  await ready(mobile);
  await mobile.screenshot({ path: join(outDir, "2026-06-23-pwa-app-mobile.png"), fullPage: true });

  const desktop = await browser.newPage({ viewport: { width: 1280, height: 832 }, deviceScaleFactor: 2 });
  await desktop.goto(base, { waitUntil: "networkidle" });
  await ready(desktop);
  await desktop.screenshot({ path: join(outDir, "2026-06-23-pwa-app-desktop.png"), fullPage: true });

  console.log(`Saved real-component screenshots to ${outDir}`);
} finally {
  await browser.close();
  server.close();
}
