import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

/**
 * Scratch config for eyeballing one component headlessly, without Tauri.
 *
 * `npx vite build preview` picks this up (the config is looked for in the
 * root), then point a headless browser at `preview/dist-<name>/<name>.html`.
 * Pass `--outDir dist-<name>` and set the entry below to whichever page is
 * being looked at. Not part of the app build.
 */
export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@core": fileURLToPath(new URL("../src/core", import.meta.url)),
      "@shared": fileURLToPath(new URL("../src/shared", import.meta.url)),
      "@standard": fileURLToPath(new URL("../src/ui/standard", import.meta.url)),
      "@aurora": fileURLToPath(new URL("../src/ui/aurora", import.meta.url)),
      "@nebula": fileURLToPath(new URL("../src/ui/nebula", import.meta.url)),
      "@ui": fileURLToPath(new URL("../src/ui", import.meta.url)),
    },
  },
  build: {
    outDir: "dist-pinned",
    emptyOutDir: true,
    rollupOptions: { input: fileURLToPath(new URL("./pinned.html", import.meta.url)) },
  },
});
