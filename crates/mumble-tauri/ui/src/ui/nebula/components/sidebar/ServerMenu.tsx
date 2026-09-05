import { useTranslation } from "react-i18next";
import { Box, Divider, Menu, MenuItem } from "@mui/material";
import type { SavedServer } from "@core/types";
import { CopyIcon, EditIcon, Link2Icon, LogOutIcon, StarIcon, TrashIcon } from "@ui/icons";
import type { ServerGroup, ServerRailEntry } from "../../selectors";

export interface ServerMenuTarget {
  entry: ServerRailEntry;
  /** True when this server's screen is the one open. */
  active: boolean;
  x: number;
  y: number;
}

interface ServerMenuProps {
  /** Right-click target and where the menu was opened, or null when closed. */
  target: ServerMenuTarget | null;
  /** Go to the server: its tab when connected, its connect page otherwise. */
  onOpen: (entry: ServerRailEntry) => void;
  /** Absent where favouriting is not offered. */
  onToggleFavorite?: (group: ServerGroup) => void;
  /** Change the saved details. Offered only while there is one identity to edit. */
  onEdit?: (identity: SavedServer) => void;
  /** Leave the session this tile reports on. */
  onDisconnect?: (entry: ServerRailEntry) => void;
  /** Drop every saved identity on this address. */
  onForget?: (group: ServerGroup) => void;
  onClose: () => void;
}

/**
 * Right-click actions on a server tile.
 *
 * Three groups: going there, keeping it (favourite, address, saved details),
 * and finally taking it away - leaving the session or forgetting the server
 * altogether. The last two are drawn in the colour that says so.
 *
 * Editing is offered only when the address has exactly one saved identity: with
 * several, "edit the server" has no single answer, and the connect screen
 * already lists each one with its own pencil.
 */
export function ServerMenu({
  target,
  onOpen,
  onToggleFavorite,
  onEdit,
  onDisconnect,
  onForget,
  onClose,
}: Readonly<ServerMenuProps>) {
  const { t } = useTranslation(["nebulaSidebar", "server"]);
  if (!target) return null;
  const { entry, active } = target;
  const { group, status, session } = entry;
  const saved = group.identities.length > 0;
  const run = (action: () => void) => () => {
    action();
    onClose();
  };

  return (
    <Menu
      open
      onClose={onClose}
      anchorReference="anchorPosition"
      anchorPosition={{ top: target.y, left: target.x }}
    >
      {/* Where you already are needs no way in; the entry would only restate
          the ring round the tile. */}
      {!active && (
        <MenuItem onClick={run(() => onOpen(entry))}>
          <Glyph>
            <Link2Icon width={13} height={13} />
          </Glyph>
          {status === "saved"
            ? t("nebulaSidebar:servers.connectTo", { server: group.label })
            : t("nebulaSidebar:servers.switchTo", { server: group.label })}
        </MenuItem>
      )}

      {onToggleFavorite && saved && (
        <MenuItem onClick={run(() => onToggleFavorite(group))}>
          <Glyph>
            <StarIcon width={13} height={13} fill={group.favorite ? "currentColor" : "none"} />
          </Glyph>
          {group.favorite ? t("server:list.removeFromFavorites") : t("server:list.addToFavorites")}
        </MenuItem>
      )}

      <MenuItem
        onClick={run(() => void navigator.clipboard?.writeText(`${group.host}:${group.port}`))}
      >
        <Glyph>
          <CopyIcon width={13} height={13} />
        </Glyph>
        {t("nebulaSidebar:servers.copyAddress")}
      </MenuItem>

      {onEdit && group.identities.length === 1 && (
        <MenuItem onClick={run(() => onEdit(group.identities[0]))}>
          <Glyph>
            <EditIcon width={13} height={13} />
          </Glyph>
          {t("server:list.editServer")}
        </MenuItem>
      )}

      {((onDisconnect && session) || (onForget && saved)) && <Divider sx={DIVIDER} />}

      {onDisconnect && session && (
        <MenuItem
          onClick={run(() => onDisconnect(entry))}
          sx={(theme) => ({ color: theme.palette.nebula.bad })}
        >
          <LogOutIcon width={13} height={13} />
          {t("nebulaSidebar:servers.disconnect")}
        </MenuItem>
      )}

      {onForget && saved && (
        <MenuItem
          onClick={run(() => onForget(group))}
          sx={(theme) => ({ color: theme.palette.nebula.bad })}
        >
          <TrashIcon width={13} height={13} />
          {t("server:list.removeServer")}
        </MenuItem>
      )}
    </Menu>
  );
}

const DIVIDER = { my: "4px", mx: "6px" } as const;

/** Item icons sit a step quieter than the label beside them. */
function Glyph({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <Box
      component="span"
      aria-hidden
      sx={(theme) => ({ display: "flex", flex: "none", color: theme.palette.nebula.muted })}
    >
      {children}
    </Box>
  );
}
