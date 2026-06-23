import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { pwaManifest } from "./src/pwa/manifest";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "autoUpdate",
      includeAssets: ["icon-192.svg", "icon-512.svg"],
      manifest: pwaManifest,
      injectManifest: {
        // Precache the built shell so the app loads offline. The custom sw.ts (push/notificationclick)
        // owns runtime behavior; only static assets are precached.
        globPatterns: ["**/*.{js,css,html,svg,woff,woff2}"],
      },
      devOptions: { enabled: false, type: "module" },
    }),
  ],
  server: { port: 5273 },
});
