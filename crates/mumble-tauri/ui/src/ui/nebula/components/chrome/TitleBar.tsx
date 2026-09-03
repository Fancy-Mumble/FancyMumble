import { useTranslation } from "react-i18next";
import { Box, IconButton, Tooltip, Typography } from "@mui/material";
import { Stack } from "../primitives";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isDesktopPlatform } from "@core/utils/platform";
import { CloseIcon, MinimizeIcon, PlusIcon, SquareIcon } from "@ui/icons";
import { BrandGlyph } from "@ui/BrandGlyph";
import { MARK_FILL, MARK_STROKE, MARK_TILE_PX } from "../../brandMark";
import { radius } from "../../tokens";
import { serverTint, type ServerRailEntry } from "../../selectors";
import { UserAvatar } from "../primitives";

interface TitleBarProps {
  /**
   * What to call the connected server, or undefined while disconnected.
   *
   * The server's own name, not the login - see `activeServerName` in
   * `NebulaClientApp`, which is where the precedence is decided.
   */
  serverLabel?: string;
  friendsActive: boolean;
  onOpenFriends: () => void;
  /** Every waiting direct message, summed, for the dot beside Friends. */
  friendsUnread?: number;
  /**
   * Opens quick connect, anchored to the button that was clicked.
   *
   * Omitted when the rail is on screen: the rail already ends in an add-server
   * button, and two plus signs one column apart read as two different things.
   */
  onQuickConnect?: (anchor: HTMLElement) => void;
  /** Whether quick connect is currently showing, for the button's state. */
  quickConnectOpen: boolean;
  onDisconnect?: () => void;
  /** Every server, when the switcher lives up here instead of on the rail. */
  entries?: readonly ServerRailEntry[];
  /** Server artwork, keyed by host:port - the tab picture. */
  icons?: ReadonlyMap<string, string>;
  activeKey?: string | null;
  onSelectServer?: (entry: ServerRailEntry) => void;
  /**
   * True when the title bar carries the whole list rather than one pill.
   *
   * False is not "no servers up here": the bar then centres the name of the
   * server you are on, because that is the window's title.
   */
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
  friendsUnread = 0,
  onQuickConnect,
  quickConnectOpen,
  onDisconnect,
  entries = [],
  icons,
  activeKey = null,
  onSelectServer,
  tabs = false,
}: Readonly<TitleBarProps>) {
  const { t } = useTranslation(["nebulaCommon", "common", "server"]);
  return (
    <Stack
      direction="row"
      alignItems="center"
      gap={1.25}
      data-tauri-drag-region
      sx={(theme) => ({
        height: 44,
        flex: "none",
        position: "relative",
        px: "14px",
        background: theme.palette.nebula.bar,
        borderBottom: `1px solid ${theme.palette.nebula.line}`,
        backdropFilter: "blur(14px)",
      })}
    >
      <BrandMark />
      <Typography sx={{ fontWeight: 600, fontSize: 13, mr: "6px", whiteSpace: "nowrap" }}>
        {t("common:brand")}
      </Typography>

      {/* Friends belongs to whichever surface is carrying the navigation. With
          the strip gone the rail has it, and drawing it in both places would
          leave the window with two of the same destination. */}
      {tabs && (
        <Box
          component="button"
          onClick={onOpenFriends}
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
            color: friendsActive ? theme.palette.nebula.barText : theme.palette.nebula.barDim,
            background: friendsActive ? theme.palette.nebula.card2 : "transparent",
            "&:hover": { background: theme.palette.nebula.hover },
          })}
        >
          {t("server:tabsBar.friends")}
          {friendsUnread > 0 && (
            <Box
              component="span"
              aria-label={t("server:tabsBar.unreadCount", { count: friendsUnread })}
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
              {friendsUnread > 99 ? "99+" : friendsUnread}
            </Box>
          )}
        </Box>
      )}

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

      {/* Without the strip the bar simply names the server you are on, centred
          the way a window title is. Deliberately not a tab: no plate, no close
          affordance, nothing to aim at - the rail (or the strip above) is where
          servers are switched and left, and a second control here would only be
          a smaller copy of one of them. Centring is absolute so it tracks the
          middle of the *window*; a flex slot would drift with the width of
          whatever sits beside it. */}
      {!tabs && serverLabel && (
        <Typography
          data-tauri-drag-region
          sx={(theme) => ({
            position: "absolute",
            left: "50%",
            transform: "translateX(-50%)",
            maxWidth: "40%",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: 12.5,
            fontWeight: 600,
            color: theme.palette.nebula.text,
            // The bar drags by its background, and this label is part of that
            // background rather than something laid over it.
            pointerEvents: "none",
          })}
        >
          {serverLabel}
        </Typography>
      )}

      {onQuickConnect && (
        <Tooltip title={t("nebulaCommon:quickConnect")}>
          <IconButton
            size="small"
            aria-label={t("nebulaCommon:quickConnect")}
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
      )}

      <Box sx={{ ml: "auto" }} />
      {isDesktopPlatform() && (
        <Stack direction="row" gap={0.5}>
          <IconButton size="small" aria-label={t("common:actions.minimize")} onClick={minimize}>
            <MinimizeIcon width={13} height={13} />
          </IconButton>
          <IconButton size="small" aria-label={t("common:actions.maximize")} onClick={toggleMaximize}>
            <SquareIcon width={11} height={11} />
          </IconButton>
          <IconButton
            size="small"
            aria-label={t("common:actions.close")}
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
  const { t } = useTranslation("server");
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
          aria-label={t("tabsBar.disconnectFrom", { label: group.label })}
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

/**
 * The app's monogram, up in the chrome.
 *
 * The tile is Nebula's - the skin's accent, the skin's corner, and its cut
 * when the skin cuts - and the letter inside it is the shared outline, which
 * paints in `currentColor` and scales to the box it is given. The taskbar
 * icon is the same tile and the same outline drawn onto a canvas, so the two
 * are one mark rather than two that agree by hand.
 */
function BrandMark() {
  return (
    <Box
      aria-hidden
      sx={(theme) => ({
        width: MARK_TILE_PX,
        height: MARK_TILE_PX,
        flex: "none",
        display: "grid",
        placeItems: "center",
        borderRadius: radius("md"),
        background: theme.palette.nebula.accent,
        color: theme.palette.nebula.onAccent,
        // A skin that cuts its corners cuts the mark's too, so the tile here
        // and the icon on the taskbar are the same shape. Written out rather
        // than taken from `--nebula-clip-bubble`, because that polygon is
        // quoted in fixed pixels for a message bubble and 12px off a 22px
        // tile would take half of it.
        ...(theme.palette.nebulaSkin.clipBubble === "none"
          ? {}
          : {
              clipPath:
                "polygon(0 0, calc(100% - 4px) 0, 100% 4px, 100% 100%, 4px 100%, 0 calc(100% - 4px))",
            }),
      })}
    >
      {/* The canvas icon strokes a fraction of the *tile*; this strokes a
          fraction of the *glyph*, which is `MARK_FILL` of the tile - and the
          stroke itself widens the box it is fitted into, which is where the
          second term comes from. Without both, the mark in the chrome comes
          out lighter than the one on the taskbar. */}
      <BrandGlyph
        embolden={MARK_STROKE / (MARK_FILL - MARK_STROKE)}
        style={{
          width: `${MARK_FILL * 100}%`,
          height: `${MARK_FILL * 100}%`,
          display: "block",
        }}
      />
    </Box>
  );
}
