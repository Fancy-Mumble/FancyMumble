import { useTranslation } from "react-i18next";
import { Box, IconButton, Tooltip } from "@mui/material";
import { PlusIcon } from "@ui/icons";
import { radius } from "../../tokens";

/**
 * Friends, and the waiting-message count beside it.
 *
 * Belongs to whichever surface is carrying the navigation - the top strip on
 * the pack's skins, the chat header on one that has no strip. Drawing it in
 * both places would leave the window with two of the same destination.
 */
export function FriendsButton({
  active,
  unread = 0,
  onOpen,
}: Readonly<{ active: boolean; unread?: number; onOpen: () => void }>) {
  const { t } = useTranslation(["server"]);
  return (
    <Box
      component="button"
      onClick={onOpen}
      sx={(theme) => ({
        all: "unset",
        position: "relative",
        cursor: "pointer",
        px: "11px",
        py: "5px",
        borderRadius: radius("md"),
        fontSize: 12.5,
        fontWeight: 500,
        whiteSpace: "nowrap",
        color: active ? theme.palette.nebula.barText : theme.palette.nebula.barDim,
        background: active ? theme.palette.nebula.card2 : "transparent",
        "&:hover": { background: theme.palette.nebula.hover },
      })}
    >
      {t("server:tabsBar.friends")}
      {unread > 0 && (
        <Box
          component="span"
          aria-label={t("server:tabsBar.unreadCount", { count: unread })}
          sx={(theme) => ({
            ml: "6px",
            px: "5px",
            borderRadius: "8px",
            fontSize: 9,
            fontWeight: 700,
            fontVariantNumeric: "tabular-nums",
            background: theme.palette.nebula.bad,
            color: theme.palette.nebula.bg0,
          })}
        >
          {unread > 99 ? "99+" : unread}
        </Box>
      )}
    </Box>
  );
}

/** The plus that opens quick connect, anchored to itself. */
export function QuickConnectButton({
  open,
  onOpen,
}: Readonly<{ open: boolean; onOpen: (anchor: HTMLElement) => void }>) {
  const { t } = useTranslation(["nebulaCommon"]);
  return (
    <Tooltip title={t("nebulaCommon:quickConnect")}>
      <IconButton
        size="small"
        aria-label={t("nebulaCommon:quickConnect")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => onOpen(event.currentTarget)}
        sx={(theme) => ({
          color: open ? theme.palette.nebula.text : undefined,
          background: open ? theme.palette.nebula.card2 : undefined,
        })}
      >
        <PlusIcon width={14} height={14} />
      </IconButton>
    </Tooltip>
  );
}
