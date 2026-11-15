/**
 * Whether the pack is laying out for one hand rather than for a window.
 *
 * Three answers, most specific first:
 *
 * 1. `data-nebula-handheld="on" | "off"` on `<html>`. The preview page and the
 *    tests' only lever, and the reason this is a hook rather than a constant.
 * 2. The viewport, at `HANDHELD_QUERY`.
 * 3. The platform. A tablet in landscape is wider than the query but is still
 *    a touch device with no window chrome, so the UA gets the last word rather
 *    than none.
 *
 * The platform check is deliberately *not* the first answer. `isMobile`
 * (`@core/utils/platform`) is a user-agent constant evaluated once at module
 * load, which makes it false in the preview harness and false in jsdom - a
 * layout gated on it alone could be neither screenshotted nor tested.
 */
import { useSyncExternalStore } from "react";
import { isMobilePlatform } from "@core/utils/platform";

/**
 * Exactly MUI's `sm` down, so a `sx={{ display: { xs, sm } }}` and this hook
 * can never disagree about where the layout changes.
 */
export const HANDHELD_QUERY = "(max-width: 599.95px)";

/** The override attribute, on `<html>` beside `data-theme`. */
export const HANDHELD_ATTR = "data-nebula-handheld";

/**
 * Feature-checked rather than assumed: `matchMedia` is absent from some test
 * environments, and the answer without it is the platform's, not a throw.
 */
function query(): MediaQueryList | null {
  return typeof globalThis.matchMedia === "function" ? globalThis.matchMedia(HANDHELD_QUERY) : null;
}

/** The stated answer, or null where nothing has stated one. */
export function handheldOverride(): boolean | null {
  const stated = document.documentElement.getAttribute(HANDHELD_ATTR);
  if (stated === "on") return true;
  if (stated === "off") return false;
  return null;
}

function readHandheld(): boolean {
  const stated = handheldOverride();
  if (stated !== null) return stated;
  return query()?.matches === true || isMobilePlatform();
}

/**
 * Both levers, watched the way `useNebulaAppearance` watches its two: the
 * attribute can be swapped at any moment by the preview page, and the viewport
 * can be resized while the window is open.
 */
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [HANDHELD_ATTR],
  });
  const media = query();
  media?.addEventListener("change", onChange);
  return () => {
    observer.disconnect();
    media?.removeEventListener("change", onChange);
  };
}

/** True when the layout should be the handheld one. */
export function useIsHandheld(): boolean {
  // The server snapshot is the desktop answer: there is no viewport to measure
  // and no `<html>` to read, and the pack has always drawn a window.
  return useSyncExternalStore(subscribe, readHandheld, () => false);
}
