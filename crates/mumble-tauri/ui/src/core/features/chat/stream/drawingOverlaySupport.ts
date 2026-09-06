/**
 * What the desktop drawing overlay can do on the machine we are running on.
 *
 * The overlay is a transparent window pinned over the shared monitor, and how
 * much of that a platform actually permits varies more than anywhere else in
 * the app:
 *
 * - Windows/macOS: it can be placed, it follows a shared window, and the OS
 *   keeps it out of the capture.
 * - Linux/X11 (the default, including `XWayland`): placed and followed, but
 *   NOT excluded from capture - neither X11 nor Wayland has an equivalent of
 *   `WDA_EXCLUDEFROMCAPTURE`, so a monitor share records the overlay too.
 * - Linux/Wayland: only a `wlr-layer-shell` compositor (KDE, sway, Hyprland,
 *   COSMIC, niri) can pin it at all; GNOME cannot, and a shared *window*
 *   cannot be located under Wayland at all.
 *
 * Asking the backend keeps that matrix in one place - in Rust, where the
 * platform calls are - instead of guessing from the user agent.
 */
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface DrawingOverlaySupport {
  /** Whether opening the overlay would work at all right now. */
  readonly available: boolean;
  /** Why not, as a stable key the UI localises. `null` when available. */
  readonly reason: string | null;
  /** Whether a shared window is followed as the user moves it. */
  readonly followsWindows: boolean;
  /** Whether the overlay stays out of the broadcaster's own stream. */
  readonly excludedFromCapture: boolean;
}

/**
 * What is assumed until the backend answers: everything works. The optimistic
 * default keeps the toggle from flickering disabled on every mount, and the
 * only cost of being wrong for one frame is a click that reports an error.
 */
export const ASSUMED_OVERLAY_SUPPORT: DrawingOverlaySupport = {
  available: true,
  reason: null,
  followsWindows: true,
  excludedFromCapture: true,
};

/** Ask the backend. Never throws: an unreachable command means an old build,
 *  where the overlay behaved as the optimistic default claims. */
export async function fetchDrawingOverlaySupport(): Promise<DrawingOverlaySupport> {
  try {
    return await invoke<DrawingOverlaySupport>("drawing_overlay_support");
  } catch {
    return ASSUMED_OVERLAY_SUPPORT;
  }
}

/**
 * Support for the overlay, re-checked whenever `deps` change.
 *
 * The answer is not constant for a session: on Wayland it depends on what is
 * being shared (a window cannot be located, a monitor can), so callers pass
 * whatever identifies the current share.
 */
export function useDrawingOverlaySupport(deps: readonly unknown[] = []): DrawingOverlaySupport {
  const [support, setSupport] = useState<DrawingOverlaySupport>(ASSUMED_OVERLAY_SUPPORT);
  useEffect(() => {
    let active = true;
    void fetchDrawingOverlaySupport().then((result) => {
      if (active) setSupport(result);
    });
    return () => {
      active = false;
    };
  }, deps);
  return support;
}

/** The `chat`-namespace keys {@link overlayReasonKey} can return. Spelled as
 *  a union so `t()` accepts the result: its key type is a literal union. */
export type OverlayReasonKey =
  | "screenShare.overlayUnsupportedWayland"
  | "screenShare.overlayUnsupportedWaylandWindow"
  | "screenShare.overlayUnsupportedPlatform"
  | "screenShare.overlayUnavailable";

/**
 * i18n key for a `reason`, under the `chat` namespace. Unknown reasons fall
 * back to a generic line rather than rendering a raw key.
 */
export function overlayReasonKey(reason: string | null): OverlayReasonKey {
  switch (reason) {
    case "wayland-no-layer-shell":
      return "screenShare.overlayUnsupportedWayland";
    case "wayland-window-share":
      return "screenShare.overlayUnsupportedWaylandWindow";
    case "unsupported-platform":
      return "screenShare.overlayUnsupportedPlatform";
    default:
      return "screenShare.overlayUnavailable";
  }
}
