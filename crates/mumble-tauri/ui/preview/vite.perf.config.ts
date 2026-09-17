import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Built against React's development bundle on purpose.
 *
 * `Profiler` is a no-op in a production build, so a harness built the usual way
 * reports nothing at all. The counts are exact either way; `rowMs` is inflated
 * by the development build's own checks, which is why it is only ever read as a
 * comparison against another run of this same harness.
 */
export default defineConfig({
  plugins: [react()],
  define: { "process.env.NODE_ENV": JSON.stringify("development") },
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  resolve: {
    alias: {
      "@core": src("../src/core"),
      "@shared": src("../src/shared"),
      "@standard": src("../src/ui/standard"),
      "@aurora": src("../src/ui/aurora"),
      "@nebula": src("../src/ui/nebula"),
      "@ui": src("../src/ui"),
    },
  },
  build: {
    outDir: src("./dist-perf"),
    emptyOutDir: true,
    minify: false,
    rollupOptions: { input: src("./perf.html") },
  },
});
