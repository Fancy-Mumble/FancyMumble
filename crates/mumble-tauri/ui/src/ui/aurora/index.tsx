/**
 * @deprecated Aurora is on its way out and is to be deleted before the next
 * release. Standard and Nebula are the two packs that ship after that.
 *
 * Nothing here is worth extending. It never adopted i18n - 131 components and
 * not one `t()` call - so choosing Aurora silently turns the client
 * English-only whatever the language setting says, which is reason enough on
 * its own not to send anyone here. Fixes belong in `standard` or `nebula`.
 */
import { lazy, Suspense, useState, type ReactNode } from "react";
import AuroraClientApp from "./AuroraClientApp";
import { DesignSheet } from "./components/designsheet/DesignSheet";

const UpdaterWindow = lazy(() => import("../standard/updater/UpdaterWindow"));
const PopoutPage = lazy(() => import("../standard/pages/PopoutPage"));
const StreamPopoutPage = lazy(() => import("../standard/pages/StreamPopoutPage"));
const DmPopoutPage = lazy(() => import("../standard/pages/DmPopoutPage"));
const DrawOverlayPage = lazy(() => import("../standard/pages/DrawOverlayPage"));
const TranslationPopoutPage = lazy(() => import("../standard/pages/TranslationPopoutPage"));

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

export default function AuroraApp() {
  const windowContent = auxiliaryWindow();
  // The design sheet is a development inventory, not a user-facing surface, so
  // it has no button in the client chrome - launch with `?design-sheet`.
  const [showDesignSheet, setShowDesignSheet] = useState(() =>
    new URLSearchParams(globalThis.location.search).has("design-sheet"),
  );

  if (windowContent) return <Suspense fallback={null}>{windowContent}</Suspense>;

  if (showDesignSheet) {
    return <DesignSheet onBackToClient={() => setShowDesignSheet(false)} />;
  }

  return <AuroraClientApp />;
}
