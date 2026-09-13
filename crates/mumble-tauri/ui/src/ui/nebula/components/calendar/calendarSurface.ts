import type { Theme } from "@mui/material/styles";
import { radius } from "../../tokens";

/**
 * The menu's surface, for the calendar's popovers.
 *
 * This pack's theme leaves `Paper` transparent and paints only menus and
 * dialogs, so a bare `Popover` would float its contents over the grid with
 * nothing behind them. The card and the work-hours popover are menus in all
 * but name, so they wear the menu's paper.
 */
export function floatingPaper(theme: Theme) {
  const { nebula } = theme.palette;
  return {
    borderRadius: radius("lg"),
    background: `${nebula.tint},${nebula.bg0}`,
    border: `var(--nebula-line-width, 1px) solid ${nebula.line2}`,
    boxShadow: nebula.shadow,
    backdropFilter: "blur(16px)",
  } as const;
}
