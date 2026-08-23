import { Box, IconButton, Tooltip, Typography } from "@mui/material";
import { Stack } from "../primitives";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isDesktopPlatform } from "@core/utils/platform";
import { CloseIcon, MinimizeIcon, PlusIcon, SquareIcon } from "@ui/icons";
import { radius } from "../../tokens";

interface TitleBarProps {
  /** Label of the connected server, or undefined while disconnected. */
  serverLabel?: string;
  friendsActive: boolean;
  onOpenFriends: () => void;
  onOpenChat: () => void;
  /** Opens quick connect, anchored to the button that was clicked. */
  onQuickConnect: (anchor: HTMLElement) => void;
  /** Whether quick connect is currently showing, for the button's state. */
  quickConnectOpen: boolean;
  onDisconnect?: () => void;
}

// Window operations resolve the window on click rather than at render so the
// bar mounts safely outside a Tauri webview (tests, browser dev server).
const minimize = () => void getCurrentWindow().minimize();
const toggleMaximize = () => void getCurrentWindow().toggleMaximize();
const close = () => void getCurrentWindow().close();

/**
 * The 44px window chrome: brand mark, the two top-level destinations, and the
 * connected-server pill. The mock puts the server itself in the title bar - it
 * is the way back to the conversation from Friends or the connect screen.
 */
export function TitleBar({
  serverLabel,
  friendsActive,
  onOpenFriends,
  onOpenChat,
  onQuickConnect,
  quickConnectOpen,
  onDisconnect,
}: Readonly<TitleBarProps>) {
  return (
    <Stack
      direction="row"
      alignItems="center"
      gap={1.25}
      data-tauri-drag-region
      sx={(theme) => ({
        height: 44,
        flex: "none",
        px: "14px",
        background: theme.palette.nebula.panel,
        borderBottom: `1px solid ${theme.palette.nebula.line}`,
        backdropFilter: "blur(14px)",
      })}
    >
      <Box
        aria-hidden
        sx={(theme) => ({
          width: 22,
          height: 22,
          borderRadius: radius("md"),
          display: "grid",
          placeItems: "center",
          background: theme.palette.nebula.accent,
          color: "#fff",
          fontWeight: 700,
          fontSize: 12,
        })}
      >
        M
      </Box>
      <Typography sx={{ fontWeight: 600, fontSize: 13, mr: "6px" }}>Fancy Mumble</Typography>

      <Box
        component="button"
        onClick={onOpenFriends}
        sx={(theme) => ({
          all: "unset",
          cursor: "pointer",
          px: "11px",
          py: "5px",
          borderRadius: radius("md"),
          fontSize: 12.5,
          fontWeight: 500,
          color: friendsActive ? theme.palette.nebula.text : theme.palette.nebula.muted,
          background: friendsActive ? theme.palette.nebula.card2 : "transparent",
          "&:hover": { background: theme.palette.nebula.hover },
        })}
      >
        Friends
      </Box>

      {serverLabel && (
        <Stack
          direction="row"
          alignItems="center"
          gap={1}
          sx={(theme) => ({
            px: "11px",
            py: "5px",
            borderRadius: radius("md"),
            fontSize: 12.5,
            fontWeight: 500,
            background: theme.palette.nebula.card2,
          })}
        >
          <Box
            component="button"
            onClick={onOpenChat}
            sx={{
              all: "unset",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 1,
            }}
          >
            <Box
              component="span"
              sx={(theme) => ({
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: theme.palette.nebula.ok,
              })}
            />
            {serverLabel}
          </Box>
          {onDisconnect && (
            <Box
              component="button"
              aria-label={`Disconnect from ${serverLabel}`}
              onClick={onDisconnect}
              sx={(theme) => ({
                all: "unset",
                cursor: "pointer",
                fontSize: 11,
                lineHeight: 1,
                color: theme.palette.nebula.dim,
                "&:hover": { color: theme.palette.nebula.bad },
              })}
            >
              ✕
            </Box>
          )}
        </Stack>
      )}

      <Tooltip title="Quick connect">
        <IconButton
          size="small"
          aria-label="Quick connect"
          aria-haspopup="menu"
          aria-expanded={quickConnectOpen}
          onClick={(event) => onQuickConnect(event.currentTarget)}
          sx={(theme) => ({
            color: quickConnectOpen ? theme.palette.nebula.text : undefined,
            background: quickConnectOpen ? theme.palette.nebula.card2 : undefined,
          })}
        >
          <PlusIcon width={14} height={14} />
        </IconButton>
      </Tooltip>

      <Box sx={{ ml: "auto" }} />
      {isDesktopPlatform() && (
        <Stack direction="row" gap={0.5}>
          <IconButton size="small" aria-label="Minimize" onClick={minimize}>
            <MinimizeIcon width={13} height={13} />
          </IconButton>
          <IconButton size="small" aria-label="Maximize" onClick={toggleMaximize}>
            <SquareIcon width={11} height={11} />
          </IconButton>
          <IconButton
            size="small"
            aria-label="Close"
            onClick={close}
            sx={(theme) => ({ "&:hover": { background: `${theme.palette.nebula.bad}33` } })}
          >
            <CloseIcon width={13} height={13} />
          </IconButton>
        </Stack>
      )}
    </Stack>
  );
}
