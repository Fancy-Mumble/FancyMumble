import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react()],
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
    outDir: src("./dist-annotate"),
    emptyOutDir: true,
    rollupOptions: { input: src("./annotate.html") },
  },
});
