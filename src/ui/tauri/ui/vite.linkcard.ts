// Build one preview page on its own.
//
// The shared config lists every entry the app has, and building all of them to
// look at one card is a minute wasted on every look. Kept beside the config it
// extends so the aliases and the plugins are the app's, not a second set that
// drifts from them.
import { defineConfig, mergeConfig } from "vite";

import base from "./vite.config";

export default mergeConfig(
  base,
  defineConfig({
    root: "preview",
    base: "./",
    build: {
      outDir: "dist-linkcard",
      emptyOutDir: true,
      rollupOptions: { input: "preview/linkcard.html" },
    },
  }),
);
