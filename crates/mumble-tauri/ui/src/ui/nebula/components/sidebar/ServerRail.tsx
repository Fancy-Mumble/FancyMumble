import { Fragment, useCallback, useRef, useState } from "react";
import { Box, Tooltip } from "@mui/material";
import { ChevronRightIcon, LogOutIcon, PlusIcon } from "@ui/icons";
import { reorderServerRail, serverTint, type ServerRailEntry } from "../../selectors";
import { UserAvatar } from "../primitives";
import { radius } from "../../tokens";
import type { ServerPingResult } from "@core/types";
import { ServerRailPanel } from "./ServerRailPanel";
import { ServerRailCard, type RailCardOccupant } from "./ServerRailCard";

/** Every tile, and the two buttons that bracket them, are one square. */
const TILE = 40;

interface ServerRailProps {
  entries: readonly ServerRailEntry[];
  /** Server artwork, keyed by host:port. Missing ones fall back to initials. */
  icons?: ReadonlyMap<string, string>;
  banners?: ReadonlyMap<string, string>;
  /** Occupancy and latency, keyed by host:port, for the pinned panel. */
  pings?: ReadonlyMap<string, ServerPingResult>;
  /** Where you are on the server you are connected to. */
  activeChannelName?: string | null;
  /** The name you arrived as on the connected server. */
  ownName?: string | null;
  /** Who is in your channel, for the card of the server you are on. */
  occupants?: readonly RailCardOccupant[];
  onCancelConnect?: (entry: ServerRailEntry) => void;
  /** The server whose screen is open, so the rail can say where you are. */
  activeKey: string | null;
  expanded: boolean;
  onToggleExpanded: () => void;
  onSelect: (entry: ServerRailEntry) => void;
  onAddServer: () => void;
  /** Absent while nothing is connected - there is then nothing to leave. */
  onDisconnect?: () => void;
  /** The new order, by host:port, after a tile is dropped. */
  onReorder?: (keys: readonly string[]) => void;
}
/**
 * One server.
 *
 * The two marks say different things, so they sit in different corners: the
 * bottom right is always about the link to the server, the top right about what
 * is waiting on it, and a tile can carry both at once. Which server you are
 * currently looking at is a ring rather than a third mark, so "where I am" never
 * competes with "how is it going".
 */
function RailTile({
  entry,
  active,
  icon,
  onSelect,
  onHover,
  onLeave,
  dragging,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: Readonly<{
  entry: ServerRailEntry;
  active: boolean;
  icon?: string;
  onSelect: () => void;
  onHover: (top: number) => void;
  onLeave: () => void;
  dragging: boolean;
  onDragStart: (event: React.DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  /** True while the pointer is over the upper half of this tile. */
  onDragOver: (before: boolean) => void;
  onDrop: () => void;
}>) {
  const { group, status, unread } = entry;
  const waiting = unread > 99 ? "99+" : String(unread);
  const detail =
    status === "connecting" ? "connecting" : status === "connected" ? "connected" : "not connected";

  return (
    // No tooltip: hovering a tile opens the card, and the two would collide.
    <Box
      component="button"
      type="button"
      aria-current={active ? "true" : undefined}
      aria-label={group.label + ", " + detail + (unread > 0 ? ", " + unread + " unread" : "")}
      onClick={onSelect}
      onMouseEnter={(event: { currentTarget: HTMLElement }) => onHover(event.currentTarget.offsetTop)}
      onMouseLeave={onLeave}
      draggable
      onDragStart={(event: React.DragEvent<HTMLElement>) => {
        // Chromium abandons a drag whose dataTransfer was left empty, so the
        // tile has to put something on it even though the drop reads state,
        // not the payload.
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", entry.group.key);
        onDragStart(event);
      }}
      onDragEnd={onDragEnd}
      onDragOver={(event: React.DragEvent<HTMLElement>) => {
        // Without this the drop is refused and the rail never reorders.
        event.preventDefault();
        const box = event.currentTarget.getBoundingClientRect();
        event.dataTransfer.dropEffect = "move";
        onDragOver(event.clientY < box.top + box.height / 2);
      }}
      onDrop={(event: React.DragEvent<HTMLElement>) => {
        event.preventDefault();
        onDrop();
      }}
      sx={(theme) => ({
        all: "unset",
        boxSizing: "border-box",
        position: "relative",
        width: TILE,
        height: TILE,
        flex: "none",
        cursor: "pointer",
        // Chromium will not start a drag on a form control without this, and a
        // text selection inside the tile would swallow the gesture.
        WebkitUserDrag: "element",
        userSelect: "none",
        borderRadius: radius("lg"),
        outline: active ? "2px solid " + theme.palette.nebula.accent : "none",
        outlineOffset: 2,
        opacity: dragging ? 0.4 : status === "saved" ? 0.72 : 1,
        transition: "transform 120ms ease",
        // The tile under the pointer lifts and takes a ring, which is what
        // ties it to the card that opens beside it.
        "&:hover": {
          opacity: 1,
          transform: "scale(1.08)",
          outline: "2px solid " + (active ? theme.palette.nebula.accent : theme.palette.nebula.line2),
        },
        "@media (prefers-reduced-motion: reduce)": {
          transition: "none",
          "&:hover": { transform: "none" },
        },
        "&:focus-visible": { outline: "2px solid " + theme.palette.nebula.accent, outlineOffset: 2 },
      })}
    >
      <UserAvatar name={group.label} size={TILE} square src={icon} gradient={serverTint(group.key)} />
      <ConnectionPip status={status} />
      {unread > 0 && <UnreadBadge label={waiting} />}
    </Box>
  );
}
/** Bottom-right: the link to the server, and nothing else. */
function ConnectionPip({ status }: Readonly<{ status: ServerRailEntry["status"] }>) {
  if (status === "saved") return null;
  return (
    <Box
      aria-hidden
      sx={(theme) => ({
        position: "absolute",
        right: -3,
        bottom: -3,
        width: 13,
        height: 13,
        borderRadius: "50%",
        display: "grid",
        placeItems: "center",
        // The disc is the window colour so the mark reads as a hole punched
        // through the tile rather than a sticker sitting on it.
        background: theme.palette.nebula.bg0,
      })}
    >
      <Box
        sx={(theme) => ({
          width: 8,
          height: 8,
          borderRadius: "50%",
          ...(status === "connected"
            ? { background: theme.palette.nebula.ok }
            : {
                border: "1.5px solid " + theme.palette.nebula.warn,
                borderTopColor: "transparent",
                animation: "nebula-rail-spin .9s linear infinite",
                "@keyframes nebula-rail-spin": { to: { transform: "rotate(360deg)" } },
                "@media (prefers-reduced-motion: reduce)": { animation: "none" },
              }),
        })}
      />
    </Box>
  );
}

/** Top-right: what is waiting, capped so three digits never widen the tile. */
function UnreadBadge({ label }: Readonly<{ label: string }>) {
  return (
    <Box
      aria-hidden
      sx={(theme) => ({
        position: "absolute",
        right: -4,
        top: -4,
        minWidth: 17,
        height: 17,
        px: "4px",
        borderRadius: "9px",
        display: "grid",
        placeItems: "center",
        background: theme.palette.nebula.bad,
        border: "2px solid " + theme.palette.nebula.bg0,
        color: theme.palette.nebula.bg0,
        fontSize: 9,
        fontWeight: 700,
        fontVariantNumeric: "tabular-nums",
      })}
    >
      {label}
    </Box>
  );
}
/**
 * The rail: every server, always in the same place.
 *
 * It lists servers rather than sessions, so a saved server nobody is connected
 * to keeps its tile. That is what makes the rail a way *in* to a server and not
 * just a switcher between the ones already open.
 */
export function ServerRail({
  entries,
  icons,
  banners,
  pings,
  activeChannelName,
  ownName,
  occupants,
  onCancelConnect,
  activeKey,
  expanded,
  onToggleExpanded,
  onSelect,
  onAddServer,
  onDisconnect,
  onReorder,
}: Readonly<ServerRailProps>) {
  // Hovering a tile opens its card; the card stays open while the pointer is
  // travelling towards it, which is the only reason the close is delayed.
  const [hovered, setHovered] = useState<{ key: string; top: number } | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const holdOpen = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);

  const closeSoon = useCallback(() => {
    holdOpen();
    closeTimer.current = setTimeout(() => setHovered(null), 120);
  }, [holdOpen]);

  const hoveredEntry = entries.find((candidate) => candidate.group.key === hovered?.key) ?? null;

  // A drag names the tile being moved and the one it would land in front of;
  // a null target means the end of the rail.
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropBefore, setDropBefore] = useState<string | null>(null);

  const endDrag = useCallback(() => {
    setDragKey(null);
    setDropBefore(null);
  }, []);

  const drop = useCallback(() => {
    if (dragKey && onReorder) onReorder(reorderServerRail(entries, dragKey, dropBefore));
    endDrag();
  }, [dragKey, dropBefore, endDrag, entries, onReorder]);

  return (
    <Box
      component="nav"
      aria-label="Servers"
      data-testid="nebula-server-rail"
      sx={(theme) => ({
        width: 56,
        flex: "none",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "7px",
        py: "10px",
        position: "relative",
        // The blur below makes this a stacking context, so the pinned panel
        // cannot lift itself above the sidebar from in here - the rail as a
        // whole has to sit above it instead.
        zIndex: 45,
        borderRight: "1px solid " + theme.palette.nebula.line,
        background: theme.palette.nebula.panel,
        backdropFilter: "blur(14px)",
      })}
    >
      <RailButton
        label={expanded ? "Collapse the server list" : "Pin the server list open"}
        onClick={onToggleExpanded}
      >
        <ChevronRightIcon
          width={15}
          height={15}
          style={{ transform: expanded ? "rotate(180deg)" : "none" }}
        />
      </RailButton>

      <Box
        aria-hidden
        sx={(theme) => ({ width: 22, height: "1px", my: "1px", background: theme.palette.nebula.line2 })}
      />

      {entries.map((entry, index) => (
        <Fragment key={entry.group.key}>
          {dragKey && dropBefore === entry.group.key && <DropSlot />}
          <RailTile
            entry={entry}
            active={entry.group.key === activeKey}
            icon={icons?.get(entry.group.key)}
            dragging={dragKey === entry.group.key}
            onSelect={() => onSelect(entry)}
            onHover={(top) => {
              if (dragKey) return;
              holdOpen();
              setHovered({ key: entry.group.key, top });
            }}
            onLeave={closeSoon}
            onDragStart={() => {
              setHovered(null);
              setDragKey(entry.group.key);
            }}
            onDragEnd={endDrag}
            onDragOver={(before) =>
              setDropBefore(before ? entry.group.key : (entries[index + 1]?.group.key ?? null))
            }
            onDrop={drop}
          />
        </Fragment>
      ))}
      {dragKey && dropBefore === null && <DropSlot />}

      <RailButton label="Add a server" onClick={onAddServer} dashed>
        <PlusIcon width={15} height={15} />
      </RailButton>

      {onDisconnect && (
        <RailButton label="Disconnect from this server" onClick={onDisconnect} tone="bad" atBottom>
          <LogOutIcon width={15} height={15} />
        </RailButton>
      )}

      {/* The pinned panel says everything the card would, so the two never
          show together. */}
      {!expanded && hoveredEntry && hovered && (
        <ServerRailCard
          entry={hoveredEntry}
          icon={icons?.get(hoveredEntry.group.key)}
          banner={banners?.get(hoveredEntry.group.key)}
          ping={pings?.get(hoveredEntry.group.key)}
          channelName={hoveredEntry.group.key === activeKey ? activeChannelName : null}
          ownName={ownName}
          occupants={hoveredEntry.group.key === activeKey ? occupants : []}
          top={hovered.top}
          onOpen={() => {
            setHovered(null);
            onSelect(hoveredEntry);
          }}
          onCancel={onCancelConnect ? () => onCancelConnect(hoveredEntry) : undefined}
          onPointerEnter={holdOpen}
          onPointerLeave={closeSoon}
        />
      )}

      {expanded && (
        <ServerRailPanel
          entries={entries}
          activeKey={activeKey}
          icons={icons}
          banners={banners}
          pings={pings}
          activeChannelName={activeChannelName}
          onClose={onToggleExpanded}
          onSelect={onSelect}
          onAddServer={onAddServer}
        />
      )}
    </Box>
  );
}

/** Where a dragged tile would land. */
function DropSlot() {
  return (
    <Box
      aria-hidden
      sx={(theme) => ({
        width: TILE,
        height: TILE,
        flex: "none",
        borderRadius: radius("lg"),
        border: "1.5px dashed " + theme.palette.nebula.accentLine,
        background: theme.palette.nebula.accentSoft,
      })}
    />
  );
}

/** The rail is one column of squares, so its three buttons share a shape. */
function RailButton({
  label,
  onClick,
  children,
  dashed = false,
  tone = "muted",
  atBottom = false,
}: Readonly<{
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  dashed?: boolean;
  tone?: "muted" | "bad";
  atBottom?: boolean;
}>) {
  return (
    <Tooltip title={label} placement="right">
      <Box
        component="button"
        type="button"
        aria-label={label}
        onClick={onClick}
        sx={(theme) => ({
          all: "unset",
          boxSizing: "border-box",
          width: TILE,
          height: TILE,
          flex: "none",
          mt: atBottom ? "auto" : 0,
          display: "grid",
          placeItems: "center",
          cursor: "pointer",
          borderRadius: radius("lg"),
          border: dashed ? "1px dashed " + theme.palette.nebula.line2 : "1px solid transparent",
          color: tone === "bad" ? theme.palette.nebula.bad : theme.palette.nebula.dim,
          "&:hover": {
            background: dashed ? "transparent" : theme.palette.nebula.hover,
            borderColor: dashed ? theme.palette.nebula.accentLine : "transparent",
            color: tone === "bad" ? theme.palette.nebula.bad : theme.palette.nebula.accent,
          },
          "&:focus-visible": { outline: "2px solid " + theme.palette.nebula.accent, outlineOffset: 2 },
        })}
      >
        {children}
      </Box>
    </Tooltip>
  );
}
