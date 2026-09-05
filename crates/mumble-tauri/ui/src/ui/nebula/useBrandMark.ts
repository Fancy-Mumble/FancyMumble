/**
 * Keep the window icon wearing the same theme as the window.
 *
 * Nebula draws a mark in the title bar - a tile in the accent with the app's
 * monogram on it - and the taskbar icon beside it was a PNG shipped with the
 * build that never changed. This redraws the icon from the live theme so the
 * two agree, on Linux by way of the icon theme rather than the window; see
 * `applyWindowIcon`.
 */
import { useEffect } from "react";
import type { Theme } from "@mui/material/styles";
import { applyWindowIcon } from "@core/windowIcon";
import { brandMark } from "./brandMark";

/**
 * Redraw the window icon whenever the theme changes.
 *
 * Keyed on the four values the mark varies by rather than on the theme object,
 * because the theme is rebuilt whenever the connected server's livery arrives
 * and each redraw is an IPC round trip with the pixels in it. The letterform
 * itself is fixed, so two skins sharing an accent and a corner draw the same
 * icon - and not drawing it twice is the point.
 */
export function useThemedWindowIcon(theme: Theme): void {
  const { nebula, nebulaSkin } = theme.palette;
  const accent = nebula.accent;
  const onAccent = nebula.onAccent;
  const radius = nebulaSkin.radiusMd;
  const chamfered = nebulaSkin.clipBubble !== "none";

  useEffect(() => {
    void applyWindowIcon(brandMark(accent, onAccent, radius, chamfered));
  }, [accent, onAccent, radius, chamfered]);
}
