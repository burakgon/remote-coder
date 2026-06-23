import type { ManifestOptions } from "vite-plugin-pwa";

/**
 * The web app manifest, extracted so it can be unit-tested (name/theme/icons) independently
 * of a full `vite build`. `vite.config.ts` feeds this straight into `VitePWA({ manifest })`.
 *
 * Theme + background use the dark `--bg` ink (#0E1116); the icons are the amber "live wire"
 * mark on that ink. `display: "standalone"` makes it an installable, app-like PWA.
 */
export const pwaManifest: Partial<ManifestOptions> = {
  name: "remote-coder",
  short_name: "remote-coder",
  description: "Operate Claude Code sessions on your machine, remotely.",
  theme_color: "#0E1116",
  background_color: "#0E1116",
  display: "standalone",
  start_url: "/",
  icons: [
    { src: "icon-192.svg", sizes: "192x192", type: "image/svg+xml", purpose: "any" },
    { src: "icon-512.svg", sizes: "512x512", type: "image/svg+xml", purpose: "any maskable" },
  ],
};
