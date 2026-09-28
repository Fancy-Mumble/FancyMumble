import { useTranslation } from "react-i18next";
import { Box } from "@mui/material";
import { Stack } from "../primitives";
import { radius } from "../../tokens";
import { serverTint, type ServerRailEntry } from "../../selectors";
import { UserAvatar } from "../primitives";
import type { ServerPingResult } from "@core/types";
import {
  RAIL_CARD_WIDTH,
  ServerRailCard,
  useRailCardHover,
  type RailCardOccupant,
} from "../sidebar/ServerRailCard";

/** How far below a tab its card hangs, and how close to the window's edge it may get. */
const CARD_DROP = 6;
const CARD_MARGIN = 8;

/**
 * The switcher, when it lives in the top strip rather than on the rail.
 *
 * Owns its own hover card: the card is a property of the strip, not of the
 * bar that happens to hold it, so a skin that moves the strip - or drops it,
 * leaving the rail as the only switcher - takes the card with it.
 */
export function ServerTabStrip({
  entries,
  icons,
  banners,
  pings,
  activeChannelName,
  ownName,
  occupants,
  activeKey = null,
  onSelectServer,
  onDisconnect,
}: Readonly<{
  entries: readonly ServerRailEntry[];
  icons?: ReadonlyMap<string, string>;
  banners?: ReadonlyMap<string, string>;
  pings?: ReadonlyMap<string, ServerPingResult>;
  activeChannelName?: string | null;
  ownName?: string | null;
  occupants?: readonly RailCardOccupant[];
  activeKey?: string | null;
  onSelectServer?: (entry: ServerRailEntry) => void;
  onDisconnect?: () => void;
}>) {
  const { hovered, show, dismiss, holdOpen, closeSoon } = useRailCardHover<{ left: number; top: number }>();
  const hoveredEntry = entries.find((candidate) => candidate.group.key === hovered?.key) ?? null;
  return (
    <>
      {/* The strip gives way before the window controls do: a dozen servers
          must not push the close button off the bar. */}
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
            onSelect={() => {
              dismiss();
              onSelectServer?.(entry);
            }}
            onDisconnect={onDisconnect}
            onHover={(tab) =>
              show(entry.group.key, {
                // Under the tab's left edge, unless that would run the card
                // off the right of the window.
                left: Math.max(
                  CARD_MARGIN,
                  Math.min(tab.left, window.innerWidth - RAIL_CARD_WIDTH - CARD_MARGIN),
                ),
                top: tab.bottom + CARD_DROP,
              })
            }
            onLeave={closeSoon}
          />
        ))}
      </Stack>

      {hoveredEntry && hovered && (
        <ServerRailCard
          fixed
          entry={hoveredEntry}
          icon={icons?.get(hoveredEntry.group.key)}
          banner={banners?.get(hoveredEntry.group.key)}
          ping={pings?.get(hoveredEntry.group.key)}
          channelName={hoveredEntry.group.key === activeKey ? activeChannelName : null}
          ownName={ownName}
          occupants={hoveredEntry.group.key === activeKey ? occupants : []}
          left={hovered.at.left}
          top={hovered.at.top}
          onOpen={() => {
            dismiss();
            onSelectServer?.(hoveredEntry);
          }}
          onPointerEnter={holdOpen}
          onPointerLeave={closeSoon}
        />
      )}
    </>
  );
}

function ServerTab({
  entry,
  icon,
  active,
  onSelect,
  onDisconnect,
  onHover,
  onLeave,
}: Readonly<{
  entry: ServerRailEntry;
  icon?: string;
  active: boolean;
  onSelect: () => void;
  onDisconnect?: () => void;
  /** The tab's box in the window, so the card can hang from it. */
  onHover: (tab: DOMRect) => void;
  onLeave: () => void;
}>) {
  const { t } = useTranslation("server");
  const { group, status, unread } = entry;
  return (
    <Stack
      direction="row"
      alignItems="center"
      gap={1}
      data-testid="nebula-server-tab"
      onMouseEnter={(event: React.MouseEvent<HTMLElement>) =>
        onHover(event.currentTarget.getBoundingClientRect())
      }
      onMouseLeave={onLeave}
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
