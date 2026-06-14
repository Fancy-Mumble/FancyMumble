import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const port = Number(process.env.VITE_PORT) || 1420;

export default defineConfig({
  plugins: [react()],

  // Prevent Vite from clearing the terminal so Tauri logs stay visible.
  clearScreen: false,

  server: {
    port,
    strictPort: true,
    // Report-only Content-Security-Policy for tuning before enforcement.
    // Served by the Vite dev server, so it is active inside the Tauri
    // webview during `tauri dev` and logs violations (and fires
    // `securitypolicyviolation` events) WITHOUT blocking anything.  It
    // mirrors the policy intended for production; once the console is
    // clean - ignoring Vite's own HMR inline-script / eval reports, which
    // do not exist in the bundled production build - promote this string
    // to the enforcing `app.security.csp` field in tauri.conf.json.
    headers: {
      "Content-Security-Policy-Report-Only": [
        "default-src 'self'",
        "script-src 'self'",
        "object-src 'none'",
        "style-src 'self' 'unsafe-inline'",
        "img-src * data: blob: asset: http://asset.localhost",
        "media-src * data: blob:",
        "font-src 'self' data:",
        "connect-src * ws: wss: ipc: http://ipc.localhost",
        "frame-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join("; "),
    },
    host: true,
    hmr: {
      // On Android devices, "localhost" resolves to the device itself.
      // Use the dev machine's LAN IP so HMR WebSocket can connect.
      host: process.env.TAURI_DEV_HOST || "localhost",
    },
  },

  // These deps are only reached through lazily-imported LiveDoc components,
  // so Vite's dependency scanner doesn't see them at startup. It then fails
  // to resolve them on first navigation ("Failed to resolve import
  // 'chart.js' ...") and re-optimizes + reloads the page. Pre-declaring them
  // here makes Vite bundle them up front, so the error and reload go away.
  optimizeDeps: {
    include: [
      "chart.js",
      "dayjs",
      "dayjs/plugin/relativeTime",
      "three",
      "three/examples/jsm/controls/OrbitControls.js",
      "three/examples/jsm/loaders/GLTFLoader.js",
    ],
  },

  // Expose TAURI_* env variables to client code.
  envPrefix: ["VITE_", "TAURI_"],

  build: {
    // Tauri uses Chromium on Windows/Linux/Android and WebKit on macOS/iOS.
    target: "esnext",
    // Tauri ships with Chromium-based WebViews on Windows/Linux/Android
    // and WKWebView on macOS/iOS.  All current WebViews understand the
    // unprefixed `backdrop-filter`, but older WKWebView still requires
    // the `-webkit-` prefix, so source CSS keeps both forms.  Important:
    // when both declarations have identical values, esbuild dedupes them
    // and keeps only the LAST one in source order.  All paired
    // declarations in this codebase are written as `-webkit-...` first,
    // unprefixed second so esbuild always preserves the standard
    // property (Android Chromium WebView rejects `-webkit-backdrop-filter`
    // as invalid and silently drops it).
    cssTarget: ["chrome108", "safari15"],
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});
