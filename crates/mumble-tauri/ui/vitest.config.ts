import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@core": fileURLToPath(new URL("./src/core", import.meta.url)),
      "@shared": fileURLToPath(new URL("./src/shared", import.meta.url)),
      "@standard": fileURLToPath(new URL("./src/ui/standard", import.meta.url)),
      "@aurora": fileURLToPath(new URL("./src/ui/aurora", import.meta.url)),
      "@nebula": fileURLToPath(new URL("./src/ui/nebula", import.meta.url)),
      "@ui": fileURLToPath(new URL("./src/ui", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    // Room for the slowest file under a full parallel run; see the note on
    // `asyncUtilTimeout` in the setup file.
    testTimeout: 20_000,
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    css: {
      // Vitest blanks every stylesheet it is not told to process, `?raw`
      // included. themeTokens.test.ts reads the bundled themes as text.
      include: [/src\/ui\/standard\/themes\/.+\.css/],
      modules: {
        classNameStrategy: "non-scoped",
      },
    },
  },
});
