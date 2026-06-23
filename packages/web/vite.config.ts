import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { pwaManifest } from "./src/pwa/manifest";
import { apiNavigationDenylist } from "./src/pwa/sw-exclusions";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon-192.svg", "icon-512.svg"],
      manifest: pwaManifest,
      workbox: {
        // Precache the built shell so the app loads offline. API/WS calls are NOT cached
        // (they need the live server + token); only the static app shell is precached, and
        // the navigation fallback is denied for the API routes so they always hit the network.
        globPatterns: ["**/*.{js,css,html,svg,woff,woff2}"],
        navigateFallbackDenylist: apiNavigationDenylist,
      },
      // Web Push is intentionally out of scope for this plan (no server push endpoint yet).
      devOptions: { enabled: false },
    }),
  ],
  server: { port: 5273 },
});
