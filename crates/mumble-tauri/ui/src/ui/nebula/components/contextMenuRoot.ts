/**
 * What a right-click on an already-open menu should do.
 *
 * An open MUI menu lays an invisible sheet over the whole window, so the next
 * right-click lands on the sheet rather than on whatever is underneath it.
 * Nothing then calls `preventDefault`, and what comes up is the webview's own
 * Back / Refresh / Inspect menu drawn on top of ours - which is the platform
 * answering a click the app was supposed to answer.
 *
 * Handed to a `Menu` as its `root` slot, this answers it the way the surface
 * underneath would have: the menu closes, and no second menu appears.
 */
import type { MouseEvent } from "react";

export function contextMenuRootSlot(onClose: () => void) {
  return {
    onContextMenu: (event: MouseEvent) => {
      event.preventDefault();
      onClose();
    },
  };
}

/**
 * What every context menu here hands MUI beyond its own content.
 *
 * Two costs come free with `Menu` and neither buys anything at a right-click.
 *
 * `Modal` locks the page as it opens: it writes `overflow: hidden` and a
 * compensating `padding-right` onto `<body>`, then puts both back on close.
 * That is a forced reflow of the whole document twice per interaction, and
 * this app has nothing behind the menu that scrolls into it - the conversation
 * keeps its own scroller. Nothing is being held still, so nothing needs
 * locking.
 *
 * And `Grow` defaults to a duration derived from the paper's height, which on a
 * tall user menu is a third of a second before the menu has finished arriving.
 * A short way in reads as immediate; no time at all on the way out means the
 * menu is gone when the entry is chosen rather than fading over what it did.
 */
export const CONTEXT_MENU_PROPS = {
  disableScrollLock: true,
  transitionDuration: { enter: 110, exit: 0 },
} as const;
