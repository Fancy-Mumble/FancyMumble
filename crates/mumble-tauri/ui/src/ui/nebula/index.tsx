// The app-wide colour themes, design tokens and bundled fonts live in
// Standard's stylesheet, and the Standard pages Nebula hosts (settings,
// administration) are written against them. Nebula pulls in the tokens only -
// not Standard's layout reset, which MUI's CssBaseline replaces.
import "@standard/theme.css";
// Nebula's own translation namespaces, registered as this chunk loads so the
// pack's strings cost a client running another design nothing at all.
import "@core/i18n/nebula";
import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { initializeStandardAppearance } from "@standard/appearance";
import NebulaClientApp from "./NebulaClientApp";

// Applies the user's saved colour theme and font to <html>. Nebula reads both
// back off `:root` to pick its own light/dark scheme and accent.
initializeStandardAppearance();

// Auxiliary windows are pack-agnostic tool surfaces (the updater, popouts, the
// drawing overlay). Nebula reuses Standard's, exactly as Aurora does - a UI
// pack owns the client, not every window the app can open.
const UpdaterWindow = lazy(() => import("@standard/updater/UpdaterWindow"));
const PopoutPage = lazy(() => import("@standard/pages/PopoutPage"));
const StreamPopoutPage = lazy(() => import("@standard/pages/StreamPopoutPage"));
const DmPopoutPage = lazy(() => import("@standard/pages/DmPopoutPage"));
const DrawOverlayPage = lazy(() => import("@standard/pages/DrawOverlayPage"));
// The game overlay is Nebula's own: it is the pack's roster card, shrunk onto
// a window that sits over a game.
const GameOverlayPage = lazy(() => import("./components/overlay/GameOverlayPage"));
const TranslationPopoutPage = lazy(() => import("@standard/pages/TranslationPopoutPage"));

/**
 * The game overlay window, with the one signal Rust needs from it.
 *
 * The signal is sent from here rather than from the page because of what it
 * means: "this webview booted and committed a frame". Rust will not hide the
 * window until it arrives, since a transparent `WebView2` window hidden before
 * its first paint stops painting and can never report readiness again - so a
 * page that failed to render would strand the overlay hidden for good. This
 * wrapper commits even when the lazy chunk beneath it does not.
 */
function GameOverlayWindow() {
  useEffect(() => {
    void invoke("game_overlay_ready").catch(() => undefined);
  }, []);
  return (
    <Suspense fallback={null}>
      <GameOverlayPage />
    </Suspense>
  );
}

function auxiliaryWindow(): ReactNode | null {
  const query = new URLSearchParams(globalThis.location.search);
  if (query.has("updater")) return <UpdaterWindow />;
  if (query.has("draw-overlay")) return <DrawOverlayPage />;
  if (query.has("game-overlay")) return <GameOverlayWindow />;
  if (query.has("stream-popout")) return <StreamPopoutPage />;
  if (query.has("popout-dm")) return <DmPopoutPage />;
  if (query.has("popout-translation")) return <TranslationPopoutPage />;
  if (query.has("popout")) return <PopoutPage />;
  const label =
    (globalThis as unknown as { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } } })
      .__TAURI_INTERNALS__?.metadata?.currentWindow?.label ?? "";
  if (label === "draw-overlay") return <DrawOverlayPage />;
  if (label === "game-overlay") return <GameOverlayWindow />;
  if (label === "popout-translation") return <TranslationPopoutPage />;
  if (label.startsWith("popout-stream-")) return <StreamPopoutPage />;
  if (label.startsWith("popout-dm-")) return <DmPopoutPage />;
  if (label.startsWith("popout-")) return <PopoutPage />;
  return null;
}

export default function NebulaApp() {
  const windowContent = auxiliaryWindow();
  if (windowContent) return <Suspense fallback={null}>{windowContent}</Suspense>;
  return <NebulaClientApp />;
}
