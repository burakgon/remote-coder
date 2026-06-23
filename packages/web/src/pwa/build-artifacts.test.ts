// @vitest-environment node
// esbuild (used by vite build) requires real Node globals; jsdom's TextEncoder breaks it.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { beforeAll, describe, expect, it } from "vitest";

// The service worker is generated at `vite build`; we can't unit-test its runtime, so instead
// we run the real build once and assert on the emitted artifacts: that the SW + manifest are
// emitted, that the manifest carries the right name/theme/icons, and — critically — that the
// SW precaches ONLY the static shell and never the live API or WebSocket (which would serve
// stale/unauthorized data and break sessions).

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "../..");
// Output under dist/ (already gitignored) so the test artifact never lands in git.
const distDir = resolve(webRoot, "dist/pwa-test");

let sw = "";
let manifest = "";

beforeAll(async () => {
  await build({
    root: webRoot,
    logLevel: "silent",
    configFile: resolve(webRoot, "vite.config.ts"),
    build: { outDir: distDir, emptyOutDir: true },
  });
  sw = readFileSync(resolve(distDir, "sw.js"), "utf8");
  manifest = readFileSync(resolve(distDir, "manifest.webmanifest"), "utf8");
}, 120_000);

describe("vite build PWA artifacts", () => {
  it("emits a service worker that precaches the app shell", () => {
    expect(sw).toContain("precacheAndRoute");
    expect(sw).toMatch(/index\.html/);
    expect(sw).toMatch(/icon-512\.svg/);
  });

  it("does NOT precache or intercept the live API or the WebSocket", () => {
    // /sessions and /fs appear ONLY inside the navigation-fallback denylist, never as a
    // precached URL or a cache route. Assert there is no precached URL for them and no ws route.
    expect(sw).not.toMatch(/url:\s*["'][^"']*\/sessions/);
    expect(sw).not.toMatch(/url:\s*["'][^"']*\/fs/);
    expect(sw).not.toMatch(/ws:\/\//);
    expect(sw).not.toMatch(/wss:\/\//);
    // The denylist IS present (the fallback is explicitly denied for the API).
    expect(sw).toMatch(/denylist/);
    expect(sw).toMatch(/\^\\\/sessions|\/\^\\\/sessions|\\\/sessions/);
  });

  it("emits a manifest with the right name, theme, and icons", () => {
    const m = JSON.parse(manifest) as {
      name: string;
      theme_color: string;
      background_color: string;
      display: string;
      icons: { src: string; sizes: string }[];
    };
    expect(m.name).toBe("remote-coder");
    expect(m.theme_color).toBe("#0E1116");
    expect(m.background_color).toBe("#0E1116");
    expect(m.display).toBe("standalone");
    expect(m.icons.map((i) => i.src)).toEqual(
      expect.arrayContaining(["icon-192.svg", "icon-512.svg"]),
    );
  });
});
