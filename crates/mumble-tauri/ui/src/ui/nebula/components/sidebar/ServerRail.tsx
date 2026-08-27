import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Box, Portal, Tooltip } from "@mui/material";
import { ChevronRightIcon, LogOutIcon, PlusIcon } from "@ui/icons";
import { reorderServerRail, serverTint, type ServerRailEntry } from "../../selectors";
import { UserAvatar } from "../primitives";
import { radius } from "../../tokens";
import type { ServerPingResult } from "@core/types";
import { ServerRailPanel, ServerRailRowGhost } from "./ServerRailPanel";
import { ServerRailCard, type RailCardOccupant } from "./ServerRailCard";

/** Every tile, and the two buttons that bracket them, are one square. */
const TILE = 40;

/** How far the pointer travels before a press becomes a drag. */
const DRAG_SLACK = 4;

/** Where one tile sat when the drag began. */
interface TileSlot {
  key: string;
  top: number;
  bottom: number;
}

/** The tiles as they stand, top to bottom, before anything moves. */
function measureSlots(tiles: ReadonlyMap<string, HTMLElement>): TileSlot[] {
  return [...tiles.entries()]
    .map(([key, element]) => {
      const box = element.getBoundingClientRect();
      return { key, top: box.top, bottom: box.bottom };
    })
    .sort((left, right) => left.top - right.top);
}

/**
 * The tile the carried one would land in front of, or null for the end.
 *
 * Measured against where the tiles were when the drag started rather than
 * where they are now, so the indicator cannot chase itself: drawing it must
 * never change the answer to where it should be drawn.
 */
function dropTarget(drag: { key: string; y: number; slots: readonly TileSlot[] }): string | null {
  for (const slot of drag.slots) {
    if (slot.key === drag.key) continue;
    if (drag.y < (slot.top + slot.bottom) / 2) return slot.key;
  }
  return null;
}

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
  onDragPointerDown,
  registerRef,
}: Readonly<{
  entry: ServerRailEntry;
  active: boolean;
  icon?: string;
  onSelect: () => void;
  onHover: (top: number) => void;
  onLeave: () => void;
  /** True for the tile currently being carried; the ghost stands in for it. */
  dragging: boolean;
  onDragPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  registerRef: (element: HTMLElement | null) => void;
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
      ref={registerRef}
      onPointerDown={(event: React.PointerEvent<HTMLElement>) => {
        // Stops the browser starting its own image drag from the avatar, which
        // cancels the pointer stream and kills the gesture before it moves.
        event.preventDefault();
        onDragPointerDown(event);
      }}
      sx={(theme) => ({
        all: "unset",
        boxSizing: "border-box",
        position: "relative",
        width: TILE,
        height: TILE,
        flex: "none",
        cursor: "pointer",
        // The rail carries its own drag, so the browser must not start a text
        // selection or a scroll from the same gesture.
        userSelect: "none",
        touchAction: "none",
        // The avatar inside is an img, which the browser will happily drag on
        // its own; the tile owns this gesture, not its contents.
        "& img": { WebkitUserDrag: "none", pointerEvents: "none" },
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

  // The rail runs its own drag rather than the browser one: HTML5 drag never
  // starts reliably on a form control inside the webview, and it gives no way
  // to draw a ghost that stays pinned to the rail while the pointer wanders.
  // The rail keeps drawing its tiles behind the pinned panel, so the two views
  // cannot share one map of elements - the panel would overwrite the rail and
  // the drag would be measured against boxes nobody can see.
  const tileRefs = useRef(new Map<string, HTMLElement>());
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const visibleRefs = () => (expanded ? rowRefs.current : tileRefs.current);
  const gesture = useRef<{ key: string; startY: number; moved: boolean } | null>(null);
  const [drag, setDrag] = useState<{
    key: string;
    y: number;
    left: number;
    width: number;
    height: number;
    slots: TileSlot[];
  } | null>(null);

  const beginGesture = useCallback(
    (key: string) => (event: React.PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      gesture.current = { key, startY: event.clientY, moved: false };
    },
    [],
  );

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const held = gesture.current;
      if (!held) return;
      // A few pixels of slack, so a click on a tile is still a click.
      if (!held.moved && Math.abs(event.clientY - held.startY) < DRAG_SLACK) return;
      if (!held.moved) {
        held.moved = true;
        setHovered(null);
        // The slots are measured once, at the moment the drag starts: the
        // indicator is drawn without moving anything, so the tiles the
        // pointer is judged against stay where they were.
        const source = visibleRefs().get(held.key)?.getBoundingClientRect();
        setDrag({
          key: held.key,
          y: event.clientY,
          // The ghost tracks the pointer up and down but stays in the rail:
          // the tile is going back into this column, not anywhere else.
          left: source?.left ?? 0,
          width: source?.width ?? TILE,
          height: source?.height ?? TILE,
          slots: measureSlots(visibleRefs()),
        });
        return;
      }
      setDrag((current) => (current ? { ...current, y: event.clientY } : current));
    };

    const end = () => {
      const held = gesture.current;
      gesture.current = null;
      if (!held?.moved) return;
      setDrag((current) => {
        if (current && onReorder) {
          onReorder(reorderServerRail(entries, current.key, dropTarget(current)));
        }
        return null;
      });
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [entries, expanded, onReorder]);

  const dragKey = drag?.key ?? null;
  const dropBefore = drag ? dropTarget(drag) : null;
  const draggedEntry = entries.find((candidate) => candidate.group.key === dragKey) ?? null;

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

      {entries.map((entry) => (
        <Fragment key={entry.group.key}>
          {dropBefore === entry.group.key && <DropLine />}
          <RailTile
            entry={entry}
            active={entry.group.key === activeKey}
            icon={icons?.get(entry.group.key)}
            dragging={dragKey === entry.group.key}
            registerRef={(element) => {
              if (element) tileRefs.current.set(entry.group.key, element);
              else tileRefs.current.delete(entry.group.key);
            }}
            onSelect={() => {
              // A drag that ends on the tile it started from must not also
              // count as a click on it.
              if (gesture.current?.moved || dragKey) return;
              onSelect(entry);
            }}
            onHover={(top) => {
              if (dragKey) return;
              holdOpen();
              setHovered({ key: entry.group.key, top });
            }}
            onLeave={closeSoon}
            onDragPointerDown={beginGesture(entry.group.key)}
          />
        </Fragment>
      ))}
      {dragKey && dropBefore === null && <DropLine />}

      {drag && draggedEntry && (
        <DragGhost y={drag.y} left={drag.left} width={drag.width} height={drag.height}>
          {expanded ? (
            <ServerRailRowGhost
              entry={draggedEntry}
              active={draggedEntry.group.key === activeKey}
              icon={icons?.get(draggedEntry.group.key)}
              banner={banners?.get(draggedEntry.group.key)}
              ping={pings?.get(draggedEntry.group.key)}
              activeChannelName={activeChannelName}
            />
          ) : (
            <UserAvatar
              name={draggedEntry.group.label}
              size={TILE}
              square
              src={icons?.get(draggedEntry.group.key)}
              gradient={serverTint(draggedEntry.group.key)}
            />
          )}
        </DragGhost>
      )}

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
          dragKey={dragKey}
          dropBefore={dropBefore}
          registerRowRef={(key, element) => {
            if (element) rowRefs.current.set(key, element);
            else rowRefs.current.delete(key);
          }}
          onRowPointerDown={beginGesture}
          onClose={onToggleExpanded}
          onSelect={onSelect}
          onAddServer={onAddServer}
        />
      )}
    </Box>
  );
}

/**
 * Where the carried tile would land.
 *
 * A hairline rather than a gap: opening a slot would move every tile below it,
 * and the pointer is being judged against where they were.
 */
function DropLine() {
  return (
    <Box
      aria-hidden
      sx={(theme) => ({
        width: TILE,
        height: 2,
        my: "-1px",
        flex: "none",
        borderRadius: "1px",
        background: theme.palette.nebula.accent,
      })}
    />
  );
}

/**
 * Whatever is being carried, under the pointer.
 *
 * Sized from the element it was picked up from, so the collapsed rail carries
 * a tile and the pinned panel carries the whole row. Rendered at the document
 * root: the rail blurs what is behind it, and a backdrop-filter makes its
 * element the containing block for anything fixed inside it - the ghost would
 * otherwise be placed against the rail rather than the window.
 */
function DragGhost({
  y,
  left,
  width,
  height,
  children,
}: Readonly<{
  y: number;
  left: number;
  width: number;
  height: number;
  children: React.ReactNode;
}>) {
  return (
    <Portal>
      <Box
        aria-hidden
        sx={(theme) => ({
          position: "fixed",
          left,
          top: y - height / 2,
          width,
          height,
          zIndex: 60,
          pointerEvents: "none",
          borderRadius: radius("lg"),
          overflow: "hidden",
          transform: "scale(1.04)",
          boxShadow: "0 12px 28px rgba(2,6,18,.55)",
          // Panel rows are translucent by design; carried, they need a ground of
          // their own or the row underneath reads through them.
          background: theme.palette.nebula.bg0,
        })}
      >
        {children}
      </Box>
    </Portal>
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
