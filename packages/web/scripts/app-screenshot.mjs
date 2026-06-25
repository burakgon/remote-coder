// Real-component PWA screenshots for the README + design sign-off. Serves the built screenshot harness
// (dist-shot/, produced by `vite build --config vite.screenshot.config.ts`) and captures the REAL app
// shell + chat + overlays. The harness reads `?scene=<name>` to pick which surface to render, so we
// drive one URL per scene and capture each — mobile (390px, dsf 2) plus a couple at desktop width —
// into docs/screenshots/.
//
// Run: pnpm -C packages/web build:shot && node packages/web/scripts/app-screenshot.mjs
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, "..", "dist-shot");
const outDir = join(__dirname, "..", "..", "..", "docs", "screenshots");
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

// The capture matrix. `wait` is a CSS selector that proves the target scene actually mounted, so we
// never snap a fallback frame. Mobile shots are 390px / dsf 2 (the PWA's primary form factor).
const MOBILE = { width: 390, height: 844, dsf: 2 };
const DESKTOP = { width: 1280, height: 860, dsf: 2 };

const SHOTS = [
  // The hero chat at both form factors — prose, table, code, the "Worked" cluster, the sent chart,
  // and the iris permission card. The mobile log auto-scrolls to the newest turn (the chart + the
  // permission card); a second mobile shot scrolls the log to the TOP to show the prose, the markdown
  // table, and the fenced code block.
  { name: "chat-mobile", scene: "chat", vp: MOBILE, wait: 'header strong.display', waitShiki: true },
  { name: "chat-mobile-top", scene: "chat", vp: MOBILE, wait: 'header strong.display', scrollTop: true, waitShiki: true },
  { name: "chat-desktop", scene: "chat", vp: DESKTOP, wait: 'header strong.display', waitShiki: true },
  // The interactive ask_user question with ASCII previews.
  { name: "question-mobile", scene: "question", vp: MOBILE, wait: 'button[aria-pressed]' },
  // The New-session directory picker (the headline) — git-aware, mobile-first. Wait for the async
  // listing to render rows.
  { name: "wizard-mobile", scene: "wizard", vp: MOBILE, wait: '.rc-picker__row' },
  // Resume past conversations — at desktop width to show the scannable list.
  { name: "resume-desktop", scene: "resume", vp: DESKTOP, wait: '.rc-resume__row' },
  // The Rewind / checkpoint sheet.
  { name: "rewind-mobile", scene: "rewind", vp: MOBILE, wait: '#rewind-title' },
  // The login / token screen.
  { name: "login-mobile", scene: "login", vp: MOBILE, wait: '.rc-login__connect' },
  // The settings panel (active-session + defaults + the coral primary).
  { name: "settings-mobile", scene: "settings", vp: MOBILE, wait: '.rc-settings__primary' },
];

async function settle(page, wait) {
  await page.waitForSelector(wait, { state: "visible", timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
}

const { chromium } = await import("playwright");
const browser = await chromium.launch();
try {
  for (const shot of SHOTS) {
    const page = await browser.newPage({
      viewport: { width: shot.vp.width, height: shot.vp.height },
      deviceScaleFactor: shot.vp.dsf,
    });
    await page.goto(`${base}?scene=${shot.scene}`, { waitUntil: "networkidle" });
    await settle(page, shot.wait);
    // Code scenes: wait for shiki's async highlight to land in the DOM (attached, not necessarily
    // visible — the block may be above the auto-scrolled fold) so the shot shows highlighted code.
    if (shot.waitShiki) {
      await page.waitForSelector(".rc-code .shiki", { state: "attached", timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(150);
    }
    if (shot.scrollTop) {
      // The conversation lives in an internal scroll region (the chat log auto-scrolls to the newest
      // turn). Scroll it to the top so this shot frames the prose + markdown table + fenced code, and
      // capture at viewport height (not fullPage, which would re-frame the bottom of the same region).
      await page.evaluate(() => {
        const log = document.querySelector('[aria-live="polite"]');
        if (log) log.scrollTop = 0;
      });
      await page.waitForTimeout(150);
      await page.screenshot({ path: join(outDir, `${shot.name}.png`) });
    } else {
      await page.screenshot({ path: join(outDir, `${shot.name}.png`), fullPage: true });
    }
    await page.close();
    console.log(`  captured ${shot.name}.png`);
  }
  console.log(`Saved screenshots to ${outDir}`);
} finally {
  await browser.close();
  server.close();
}
