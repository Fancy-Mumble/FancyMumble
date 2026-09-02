// The app-wide colour themes, design tokens and bundled fonts live in
// Standard's stylesheet, and the Standard pages Nebula hosts (settings,
// administration) are written against them. Nebula pulls in the tokens only -
// not Standard's layout reset, which MUI's CssBaseline replaces.
import "@standard/theme.css";
// Nebula's own translation namespaces, registered as this chunk loads so the
// pack's strings cost a client running another design nothing at all.
import "@core/i18n/nebula";
import { lazy, Suspense, type ReactNode } from "react";
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
const TranslationPopoutPage = lazy(() => import("@standard/pages/TranslationPopoutPage"));

function auxiliaryWindow(): ReactNode | null {
  const query = new URLSearchParams(globalThis.location.search);
  if (query.has("updater")) return <UpdaterWindow />;
  if (query.has("draw-overlay")) return <DrawOverlayPage />;
  if (query.has("stream-popout")) return <StreamPopoutPage />;
  if (query.has("popout-dm")) return <DmPopoutPage />;
  if (query.has("popout-translation")) return <TranslationPopoutPage />;
  if (query.has("popout")) return <PopoutPage />;
  const label =
    (globalThis as unknown as { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } } })
      .__TAURI_INTERNALS__?.metadata?.currentWindow?.label ?? "";
  if (label === "draw-overlay") return <DrawOverlayPage />;
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
