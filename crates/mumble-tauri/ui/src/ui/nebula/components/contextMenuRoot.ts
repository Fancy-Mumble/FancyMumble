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
