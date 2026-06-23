import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// Dev-only build for the real-component screenshot harness. Emits screenshot.html → dist-shot/ so
// the production `dist/` (and its PWA/service-worker setup) is never touched. Relative base so the
// static file server in scripts/app-screenshot.mjs resolves /assets correctly.
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "dist-shot",
    emptyOutDir: true,
    rollupOptions: { input: resolve(here, "screenshot.html") },
  },
});
