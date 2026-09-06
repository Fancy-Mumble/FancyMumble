import { useTranslation } from "react-i18next";
import { Box, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { Stack } from "../primitives";
import { BrandGlyph } from "@ui/BrandGlyph";
import { MARK_FILL, MARK_STROKE, MARK_TILE_PX } from "../../brandMark";
import { radius } from "../../tokens";
import type { ServerRailEntry } from "../../selectors";
import type { ServerPingResult } from "@core/types";
import type { RailCardOccupant } from "../sidebar/ServerRailCard";
import { ServerTabStrip } from "./ServerTabStrip";
import { FriendsButton, QuickConnectButton } from "./ChromeNav";
import { WindowControls } from "./WindowControls";

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
  /** The rest of what the hover card shows, keyed like `icons`; see `ServerRail`. */
  banners?: ReadonlyMap<string, string>;
  pings?: ReadonlyMap<string, ServerPingResult>;
  /** Where you are on the server you are connected to. */
  activeChannelName?: string | null;
  /** The name you arrived as on the connected server. */
  ownName?: string | null;
  /** Who is in your channel, for the card of the server you are on. */
  occupants?: readonly RailCardOccupant[];
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

/**
 * The band across the top, and nothing more.
 *
 * What it holds is the skin's decision, not this component's: `chromeSlots`
 * says which of the four pieces belong here, and the shell renders the rest
 * wherever the skin sent them. A skin that hides the band renders none of
 * this at all - see `NebulaClientApp`, which reads the same slots.
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
  banners,
  pings,
  activeChannelName,
  ownName,
  occupants,
  activeKey = null,
  onSelectServer,
  tabs = false,
}: Readonly<TitleBarProps>) {
  const { t } = useTranslation(["nebulaCommon", "common", "server"]);
  const slots = useTheme().palette.nebulaSkin.chromeSlots;
  if (slots.band === "hidden") return null;

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
        borderBottom: `var(--nebula-line-width, 1px) solid ${theme.palette.nebula.line}`,
        backdropFilter: "blur(14px)",
      })}
    >
      <BrandMark />
      <Typography sx={{ fontWeight: 600, fontSize: 13, mr: "6px", whiteSpace: "nowrap" }}>
        {t("common:brand")}
      </Typography>

      {tabs && slots.navigation === "band" && (
        <FriendsButton active={friendsActive} unread={friendsUnread} onOpen={onOpenFriends} />
      )}

      {tabs && slots.servers === "band" && (
        <ServerTabStrip
          entries={entries}
          icons={icons}
          banners={banners}
          pings={pings}
          activeChannelName={activeChannelName}
          ownName={ownName}
          occupants={occupants}
          activeKey={activeKey}
          onSelectServer={onSelectServer}
          onDisconnect={onDisconnect}
        />
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

      {onQuickConnect && slots.navigation === "band" && (
        <QuickConnectButton open={quickConnectOpen} onOpen={onQuickConnect} />
      )}

      <Box sx={{ ml: "auto" }} />
      {slots.windowControls === "band" && <WindowControls />}
    </Stack>
  );
}

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
