import { Box, IconButton, Tooltip, Typography } from "@mui/material";
import { Stack } from "../primitives";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isDesktopPlatform } from "@core/utils/platform";
import { CloseIcon, MinimizeIcon, PlusIcon, SquareIcon } from "@ui/icons";
import { radius } from "../../tokens";
import { serverTint, type ServerRailEntry } from "../../selectors";
import { UserAvatar } from "../primitives";

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
  /** Every server, when the switcher lives up here instead of on the rail. */
  entries?: readonly ServerRailEntry[];
  /** Server artwork, keyed by host:port - the tab picture. */
  icons?: ReadonlyMap<string, string>;
  activeKey?: string | null;
  onSelectServer?: (entry: ServerRailEntry) => void;
  /** True when the title bar carries the whole list rather than one pill. */
  tabs?: boolean;
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
  entries = [],
  icons,
  activeKey = null,
  onSelectServer,
  tabs = false,
}: Readonly<TitleBarProps>) {
  const activeEntry = entries.find((entry) => entry.group.key === activeKey) ?? null;

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
      <Typography sx={{ fontWeight: 600, fontSize: 13, mr: "6px", whiteSpace: "nowrap" }}>
        Fancy Mumble
      </Typography>

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

      {/* The strip gives way before the window controls do: a dozen servers
          must not push the close button off the bar. */}
      {tabs && (
        <Stack
          direction="row"
          alignItems="center"
          gap={0.5}
          sx={{
            minWidth: 0,
            overflowX: "auto",
            scrollbarWidth: "none",
            "&::-webkit-scrollbar": { display: "none" },
          }}
        >
          {entries.map((entry) => (
            <ServerTab
              key={entry.group.key}
              entry={entry}
              icon={icons?.get(entry.group.key)}
              active={entry.group.key === activeKey}
              onSelect={() => onSelectServer?.(entry)}
              onDisconnect={onDisconnect}
            />
          ))}
        </Stack>
      )}

      {!tabs && serverLabel && (
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
            {activeEntry ? (
              <ServerFavicon entry={activeEntry} icon={icons?.get(activeEntry.group.key)} />
            ) : (
              <Box
                component="span"
                sx={(theme) => ({
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: theme.palette.nebula.ok,
                })}
              />
            )}
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

/**
 * One server, up in the window chrome.
 *
 * The picture is the point: a browser tab is found by its favicon long before
 * its title is read, and a rail of servers works the same way. The label is
 * what confirms the choice, not what makes it.
 */
function ServerTab({
  entry,
  icon,
  active,
  onSelect,
  onDisconnect,
}: Readonly<{
  entry: ServerRailEntry;
  icon?: string;
  active: boolean;
  onSelect: () => void;
  onDisconnect?: () => void;
}>) {
  const { group, status, unread } = entry;
  return (
    <Stack
      direction="row"
      alignItems="center"
      gap={1}
      sx={(theme) => ({
        px: "9px",
        py: "4px",
        borderRadius: radius("md"),
        fontSize: 12.5,
        fontWeight: 500,
        maxWidth: 190,
        background: active ? theme.palette.nebula.card2 : "transparent",
        color: active ? theme.palette.nebula.text : theme.palette.nebula.muted,
        "&:hover": { background: theme.palette.nebula.hover },
      })}
    >
      <Box
        component="button"
        type="button"
        onClick={onSelect}
        aria-current={active ? "true" : undefined}
        sx={{
          all: "unset",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: "7px",
          minWidth: 0,
        }}
      >
        <ServerFavicon entry={entry} icon={icon} />
        <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {group.label}
        </Box>
        {status !== "connected" && (
          <Box component="span" sx={(theme) => ({ fontSize: 10, color: theme.palette.nebula.dim })}>
            {status === "connecting" ? "…" : ""}
          </Box>
        )}
        {unread > 0 && (
          <Box
            component="span"
            sx={(theme) => ({
              minWidth: 15,
              height: 15,
              px: "4px",
              borderRadius: "8px",
              display: "grid",
              placeItems: "center",
              background: theme.palette.nebula.bad,
              color: theme.palette.nebula.bg0,
              fontSize: 9,
              fontWeight: 700,
            })}
          >
            {unread > 99 ? "99+" : unread}
          </Box>
        )}
      </Box>
      {active && onDisconnect && (
        <Box
          component="button"
          type="button"
          aria-label={"Disconnect from " + group.label}
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
  );
}

/** The server picture, at the size a tab can spare. */
function ServerFavicon({ entry, icon }: Readonly<{ entry: ServerRailEntry; icon?: string }>) {
  return (
    <Box sx={{ display: "flex", flex: "none", borderRadius: radius("sm"), overflow: "hidden" }}>
      <UserAvatar
        name={entry.group.label}
        size={15}
        square
        src={icon}
        gradient={serverTint(entry.group.key)}
      />
    </Box>
  );
}
