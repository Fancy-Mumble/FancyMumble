/**
 * The server menu, on a long press.
 *
 * A window opens it with a right-click on a tile. A phone has no right button,
 * but Android's webview answers a long press with the same `contextmenu`
 * event - so the same menu, with the same handlers, is one listener away.
 * Without it a phone had no way at all to edit, favourite, leave or forget a
 * saved server: the start screen's rows and the strip's tiles only opened one.
 */
import { useCallback, useState, type MouseEvent, type ReactNode } from "react";
import type { ServerRailEntry } from "../../selectors";
import type { ServerStripModel } from "../../shellModel";
import { ServerMenu, type ServerMenuTarget } from "../sidebar/ServerMenu";

export interface ServerMenuHandle {
  /** Open the menu for `entry` where the press landed. */
  open: (entry: ServerRailEntry, event: MouseEvent) => void;
  /** The menu itself, to be drawn once by whoever owns the hook. */
  menu: ReactNode;
}

export function useServerMenu(model: ServerStripModel): ServerMenuHandle {
  const [target, setTarget] = useState<ServerMenuTarget | null>(null);
  const { activeKey } = model;

  const open = useCallback(
    (entry: ServerRailEntry, event: MouseEvent) => {
      // Otherwise the webview's own long-press answer - text selection, and on
      // release a click that would open the server - follows the menu.
      event.preventDefault();
      setTarget({ entry, active: entry.group.key === activeKey, x: event.clientX, y: event.clientY });
    },
    [activeKey],
  );

  const menu = (
    <ServerMenu
      target={target}
      onOpen={model.onSelect}
      onToggleFavorite={model.onToggleFavorite}
      onEdit={model.onEditServer}
      onDisconnect={model.onLeaveServer}
      onForget={model.onForgetServer}
      onClose={() => setTarget(null)}
    />
  );

  return { open, menu };
}
