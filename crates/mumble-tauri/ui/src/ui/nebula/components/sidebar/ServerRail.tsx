import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Box, Portal, Tooltip } from "@mui/material";
import { alpha, lighten, useTheme } from "@mui/material/styles";
import { ChevronRightIcon, LogOutIcon, PlusIcon, SpinnerIcon, UsersGroupIcon } from "@ui/icons";
import { reorderServerRail, serverTint, type ServerGroup, type ServerRailEntry } from "../../selectors";
import { dropTarget, makeRoom, measureSlots, type DragSlot } from "@ui/dragOrder";
import { MakeRoom, UserAvatar } from "../primitives";
import { radius } from "../../tokens";
import { BRAND_WORDMARK } from "../../brand";
import type { SavedServer, ServerPingResult } from "@core/types";
import { RAIL_PANEL_MS, ServerRailPanel, ServerRailRowGhost, type RailFriends } from "./ServerRailPanel";
import { ServerRailCard, useRailCardHover, type RailCardOccupant } from "./ServerRailCard";
import { ServerMenu, type ServerMenuTarget } from "./ServerMenu";
import { frost } from "../../theme";

/** Every tile, and the two buttons that bracket them, are one square. */
const TILE = 40;

/** How far the pointer travels before a press becomes a drag. */
const DRAG_SLACK = 4;

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
  /**
   * The list is this screen's sidebar, not a panel over one.
   *
   * The connect screen has no other left column - what it had listed the same
   * servers - so there the rail hands its whole job to the open list: the
   * column of tiles gives way to it rather than sitting beside a second copy
   * of itself.
   */
  pinned?: boolean;
  /** The field that filters the open list, for whoever owns the query. */
  search?: ReactNode;
  /** The rows to list, already filtered. The tiles always show every server. */
  panelEntries?: readonly ServerRailEntry[];
  onToggleExpanded: () => void;
  onSelect: (entry: ServerRailEntry) => void;
  onAddServer: () => void;
  /** Absent where favouriting is not offered; the star is then not drawn. */
  onToggleFavorite?: (group: ServerGroup) => void;
  /** Absent while nothing is connected - there is then nothing to leave. */
  onDisconnect?: () => void;
  /** Leave the session a particular tile reports on, from its menu. */
  onLeaveServer?: (entry: ServerRailEntry) => void;
  /** Change a saved server's details, from its menu. */
  onEditServer?: (identity: SavedServer) => void;
  /** Drop every identity saved on an address, from its menu. */
  onForgetServer?: (group: ServerGroup) => void;
  /** Friends, when the title bar is not carrying it. */
  friends?: RailFriends;
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
  onContextMenu,
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
  onContextMenu: (x: number, y: number) => void;
  onHover: (top: number) => void;
  onLeave: () => void;
  /** True for the tile currently being carried; the ghost stands in for it. */
  dragging: boolean;
  onDragPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  registerRef: (element: HTMLElement | null) => void;
}>) {
  const { t } = useTranslation("nebulaSidebar");
  const { group, status, unread } = entry;
  const skin = useTheme().palette.nebulaSkin;
  const graded = skin.chrome === "stencil";
  const waiting = unread > 99 ? "99+" : String(unread);
  const detail =
    status === "connecting"
      ? t("servers.connecting_state")
      : status === "connected"
        ? t("servers.connected")
        : t("servers.notConnected");

  return (
    // No tooltip: hovering a tile opens the card, and the two would collide.
    <Box
      component="button"
      type="button"
      aria-current={active ? "true" : undefined}
      aria-label={
        unread > 0
          ? t("servers.tileLabelUnread", { server: group.label, state: detail, count: unread })
          : t("servers.tileLabel", { server: group.label, state: detail })
      }
      onClick={onSelect}
      onContextMenu={(event: React.MouseEvent<HTMLElement>) => {
        // The webview's own menu is about the page, not the server.
        event.preventDefault();
        onContextMenu(event.clientX, event.clientY);
      }}
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
        borderRadius: radius("rail"),
        // The ring the open server wears. An `outline` takes one colour, so
        // the graded one is a plate behind the tile instead, four pixels
        // proud on every side - the avatar covers the middle, leaving the
        // gradient showing as a frame. Everything else keeps the outline: a
        // flat ring is what eleven of the skins draw, and a plate would sit
        // behind a tile whose corners are rounded differently.
        ...(active && graded
          ? {
              // The gold flash the artboard puts against the rail's own edge
              // for the server you are on - the same mark the open channel
              // wears, and the rail's only warm colour. Reached by measuring
              // back across the padding that centres the tile, because the
              // bar belongs to the rail and the tile is what knows it is the
              // active one.
              "&::before": {
                content: '""',
                position: "absolute",
                left: -(skin.railWidth - TILE) / 2,
                top: 3,
                bottom: 3,
                width: 6,
                background: theme.palette.nebula.accentOnRail,
              },
              "&::after": {
                content: '""',
                position: "absolute",
                inset: -4,
                zIndex: -1,
                borderRadius: radius("rail"),
                background: `linear-gradient(155deg, ${lighten(
                  theme.palette.nebula.accent,
                  0.55,
                )}, ${theme.palette.nebula.accent} 70%, ${theme.palette.nebula.accent})`,
                // Thrown by the ring rather than the tile, so the tile's own
                // picture keeps its edges and only the frame lights up.
                boxShadow: `0 0 16px ${alpha(theme.palette.nebula.accent, 0.75)}`,
              },
            }
          : { outline: active ? "2px solid " + theme.palette.nebula.accent : "none" }),
        outlineOffset: 2,
        opacity: dragging ? 0.4 : status === "saved" ? 0.72 : 1,
        transition: "transform 120ms ease",
        // The tile under the pointer lifts and takes a ring, which is what
        // ties it to the card that opens beside it.
        "&:hover": {
          opacity: 1,
          transform: "scale(1.08)",
          outline:
            active && graded
              ? "none"
              : "2px solid " + (active ? theme.palette.nebula.accent : theme.palette.nebula.line2),
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

/**
 * Friends, as a tile.
 *
 * Shaped like `RailButton` rather than like `RailTile`: it is a destination,
 * not a server, and giving it an avatar would put it in the list it is meant
 * to sit apart from. It takes the same ring and the same badge as a tile,
 * because "you are here" and "something is waiting" have to read the same way
 * everywhere in this column.
 */
function FriendsTile({ active, unread, onOpen }: Readonly<RailFriends>) {
  const { t } = useTranslation(["nebulaSidebar", "server"]);
  const waiting = unread > 99 ? "99+" : String(unread);
  return (
    <Tooltip title={t("server:tabsBar.friends")} placement="right">
      <Box
        component="button"
        type="button"
        aria-label={
          unread > 0
            ? t("nebulaSidebar:friends.tileLabelUnread", { count: unread })
            : t("server:tabsBar.friends")
        }
        aria-current={active ? "true" : undefined}
        onClick={onOpen}
        sx={(theme) => ({
          all: "unset",
          boxSizing: "border-box",
          position: "relative",
          width: TILE,
          height: TILE,
          flex: "none",
          display: "grid",
          placeItems: "center",
          cursor: "pointer",
          borderRadius: radius("rail"),
          // A filled plate, like every other square in this column. Every
          // server tile is artwork edge to edge, so an outline round a small
          // glyph read as a lighter thing than its neighbours rather than as
          // one of them - the fill is what makes it weigh the same.
          border: "var(--nebula-line-width, 1px) solid " + (active ? theme.palette.nebula.accentLine : theme.palette.nebula.line2),
          background: active ? theme.palette.nebula.accentSoft : theme.palette.nebula.card2,
          color: active ? theme.palette.nebula.accent : theme.palette.nebula.muted,
          outline: active ? "2px solid " + theme.palette.nebula.accent : "none",
          outlineOffset: 2,
          "&:hover": {
            borderColor: theme.palette.nebula.accentLine,
            color: active ? theme.palette.nebula.accent : theme.palette.nebula.text,
          },
          "&:focus-visible": { outline: "2px solid " + theme.palette.nebula.accent, outlineOffset: 2 },
        })}
      >
        {/* Sized against a tile filled by a 40px avatar, not against the icons
            in the buttons above and below it: the glyph has to carry the same
            square the artwork does. */}
        <UsersGroupIcon width={22} height={22} />
        {unread > 0 && <UnreadBadge label={waiting} />}
      </Box>
    </Tooltip>
  );
}

/** The hairline that separates one group of the column from the next. */
/**
 * The expander, as the artboard draws it: an open ring turning around a gold
 * core.
 *
 * It turns whether or not anything is loading, which is the point - the mark
 * is the skin's, not a progress report, and a ring that only moved sometimes
 * would be read as one. Slowly, because it turns all the time and a fast
 * ring beside a still column is the only thing the eye then looks at.
 * Stilled for anyone who has asked motion to stop.
  */
function StencilExpander() {
  return (
    <Box
      aria-hidden
      component="svg"
      viewBox="0 0 26 26"
      width={26}
      height={26}
      sx={{ display: "block" }}
    >
      {/* One viewBox for all three marks rather than a stack of boxes that
          each centre themselves: the rail is an odd width around an even
          tile, so the mark lands on a half pixel, and separate centrings are
          free to round it different ways. Sharing a coordinate system makes
          them concentric wherever the box falls. */}
      {/* A full, faint circle under the turning arc. The arc is 300 degrees
          of ink, so its centre of mass sits about 1.7px off the geometric
          centre - and because it turns, that imbalance orbits the core and
          the mark reads as off-centre however exactly it is placed. The track
          draws a complete circle round the core and the bright arc becomes a
          highlight riding it. Sized in the icon's own units scaled to this
          box: radius 9 of 24 is 9.75 of 26, and so is its 2px stroke. */}
      <Box
        component="circle"
        cx={13}
        cy={13}
        r={9.75}
        sx={{ fill: "none", stroke: "currentColor", strokeWidth: 2.17, opacity: 0.3 }}
      />
      <Box
        component="g"
        sx={{
          transformBox: "view-box",
          transformOrigin: "13px 13px",
          animation: "nebula-rail-spin 3.2s linear infinite",
          "@keyframes nebula-rail-spin": {
            from: { transform: "rotate(0deg)" },
            to: { transform: "rotate(360deg)" },
          },
          "@media (prefers-reduced-motion: reduce)": { animation: "none" },
        }}
      >
        <SpinnerIcon width={26} height={26} />
      </Box>
      <Box
        component="circle"
        cx={13}
        cy={13}
        r={4.5}
        sx={(theme) => ({ fill: theme.palette.nebula.accent2 })}
      />
    </Box>
  );
}

function RailDivider() {
  return (
    <Box
      aria-hidden
      sx={(theme) => ({ width: 22, height: "1px", my: "1px", background: theme.palette.nebula.line2 })}
    />
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
  pinned = false,
  search,
  panelEntries,
  onToggleExpanded,
  onSelect,
  onAddServer,
  onToggleFavorite,
  onDisconnect,
  onLeaveServer,
  onEditServer,
  onForgetServer,
  friends,
  onReorder,
}: Readonly<ServerRailProps>) {
  const { t } = useTranslation("nebulaSidebar");
  const stencil = useTheme().palette.nebulaSkin.chrome === "stencil";
  // Pinned, the list is simply always open; there is no tile column left to
  // collapse back into.
  const open = expanded || pinned;
  // Hovering a tile opens its card, a distance down the rail; `at` is that
  // distance.
  const { hovered, show, dismiss, holdOpen, closeSoon } = useRailCardHover<number>();
  // The right-click menu; the hover card gives way to it, since both would
  // otherwise be open beside the same tile.
  const [menu, setMenu] = useState<ServerMenuTarget | null>(null);

  const hoveredEntry = entries.find((candidate) => candidate.group.key === hovered?.key) ?? null;

  // The floating panel outlives its own collapse: it has to stay on the screen
  // for as long as it takes to slide back out of it. `leaving` is that stretch,
  // and it is the panel's own state rather than the caller's - whoever owns
  // `expanded` has already had its answer.
  const panelElement = useRef<HTMLElement | null>(null);
  const [mounted, setMounted] = useState(expanded);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (expanded) {
      setMounted(true);
      setLeaving(false);
      return;
    }
    if (!mounted) return;
    setLeaving(true);
    const timer = window.setTimeout(() => {
      setMounted(false);
      setLeaving(false);
    }, RAIL_PANEL_MS);
    return () => window.clearTimeout(timer);
  }, [expanded, mounted]);

  // Anywhere but the panel closes it. It is laid over the screen rather than
  // given a column of its own, so the click that dismisses it is whichever one
  // lands on what it was covering - and that click still reaches what it hit,
  // since this only watches. The right-click menu is the exception: it belongs
  // to a row in here even though it is drawn elsewhere, and it closes itself.
  useEffect(() => {
    if (pinned || !expanded || menu) return;
    const away = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && panelElement.current?.contains(target)) return;
      onToggleExpanded();
    };
    window.addEventListener("pointerdown", away, true);
    return () => window.removeEventListener("pointerdown", away, true);
  }, [expanded, pinned, menu, onToggleExpanded]);

  // The rail runs its own drag rather than the browser one: HTML5 drag never
  // starts reliably on a form control inside the webview, and it gives no way
  // to draw a ghost that stays pinned to the rail while the pointer wanders.
  // The rail keeps drawing its tiles behind the pinned panel, so the two views
  // cannot share one map of elements - the panel would overwrite the rail and
  // the drag would be measured against boxes nobody can see.
  const tileRefs = useRef(new Map<string, HTMLElement>());
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const visibleRefs = () => (open ? rowRefs.current : tileRefs.current);
  const gesture = useRef<{ key: string; startY: number; moved: boolean } | null>(null);
  const [drag, setDrag] = useState<{
    key: string;
    y: number;
    left: number;
    width: number;
    height: number;
    /** The column the pointer is judged against: whichever one is on screen. */
    slots: DragSlot[];
    /**
     * The tiles, which open their gap as well. They keep being drawn beside
     * the open list, and a list that rearranged itself while the column behind
     * it stood still would show two different orders at once.
     */
    tiles: DragSlot[];
  } | null>(null);

  const beginGesture = useCallback(
    (key: string) => (event: React.PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      gesture.current = { key, startY: event.clientY, moved: false };
    },
    [],
  );

  /** A press that turned into a drag is not a request for a menu. */
  const openMenu = useCallback(
    (entry: ServerRailEntry, x: number, y: number) => {
      if (gesture.current?.moved) return;
      dismiss();
      setMenu({ entry, active: entry.group.key === activeKey, x, y });
    },
    [activeKey, dismiss],
  );

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const held = gesture.current;
      if (!held) return;
      // A few pixels of slack, so a click on a tile is still a click.
      if (!held.moved && Math.abs(event.clientY - held.startY) < DRAG_SLACK) return;
      if (!held.moved) {
        held.moved = true;
        dismiss();
        // The slots are measured once, at the moment the drag starts: the gap
        // that follows is drawn with transforms rather than laid out, so the
        // tiles the pointer is judged against stay where they were.
        const source = visibleRefs().get(held.key)?.getBoundingClientRect();
        const tiles = measureSlots(tileRefs.current);
        setDrag({
          key: held.key,
          y: event.clientY,
          // The ghost tracks the pointer up and down but stays in the rail:
          // the tile is going back into this column, not anywhere else.
          left: source?.left ?? 0,
          width: source?.width ?? TILE,
          height: source?.height ?? TILE,
          slots: open ? measureSlots(rowRefs.current) : tiles,
          tiles,
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
  }, [entries, open, onReorder, dismiss]);

  const dragKey = drag?.key ?? null;
  const dropBefore = drag ? dropTarget(drag) : null;
  const draggedEntry = entries.find((candidate) => candidate.group.key === dragKey) ?? null;

  // Both columns show the same move, each in its own row heights.
  const tileGaps = drag ? makeRoom(drag.tiles, drag.key, dropBefore) : null;
  const rowGaps = drag ? makeRoom(drag.slots, drag.key, dropBefore) : null;

  // Whatever is being carried, as a portal: it belongs to the gesture rather
  // than to the column the gesture started in, and the pinned panel drags too.
  const ghost =
    drag && draggedEntry ? (
      <DragGhost y={drag.y} left={drag.left} width={drag.width} height={drag.height}>
        {open ? (
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
    ) : null;

  const panel = (
    <ServerRailPanel
      // The tiles always show every server, so the rail stays a fixed place to
      // aim at; only the rows answer to the search field.
      entries={panelEntries ?? entries}
      activeKey={activeKey}
      icons={icons}
      banners={banners}
      pings={pings}
      activeChannelName={activeChannelName}
      dragKey={dragKey}
      gaps={rowGaps}
      pinned={pinned}
      leaving={leaving}
      ref={panelElement}
      search={search}
      // Only the filter can empty a list that has servers in it; with none
      // saved at all the add button below is the whole answer.
      empty={entries.length > 0 ? t("servers.noMatch") : undefined}
      registerRowRef={(key, element) => {
        if (element) rowRefs.current.set(key, element);
        else rowRefs.current.delete(key);
      }}
      onRowPointerDown={beginGesture}
      onClose={pinned ? undefined : onToggleExpanded}
      friends={friends}
      onSelect={onSelect}
      onContextMenu={openMenu}
      onAddServer={onAddServer}
      onToggleFavorite={onToggleFavorite}
    />
  );

  const serverMenu = (
    <ServerMenu
      target={menu}
      onOpen={onSelect}
      onToggleFavorite={onToggleFavorite}
      onEdit={onEditServer}
      onDisconnect={onLeaveServer}
      onForget={onForgetServer}
      onClose={() => setMenu(null)}
    />
  );

  // Pinned, the open list is the column. Drawing the tiles beside it would put
  // the same servers on the screen twice - which is the thing that made the
  // two lists worth merging in the first place.
  if (pinned)
    return (
      <>
        {ghost}
        {panel}
        {serverMenu}
      </>
    );

  return (
    <Box
      component="nav"
      aria-label={t("servers.title")}
      data-testid="nebula-server-rail"
      sx={(theme) => ({
        width: theme.palette.nebulaSkin.railWidth,
        flex: "none",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        // The artboard stands its tiles further apart than the pack does -
        // a wider rail with the same 40px tile has room to, and the ring the
        // open one wears needs somewhere to bleed.
        gap: stencil ? "16px" : "7px",
        // The dashed band is absolute, so it takes no room in the column: on
        // a skin that draws one, the padding has to clear it by hand - past
        // where it starts, past its height, and then a gap of its own.
        pt: stencil ? "30px" : "10px",
        pb: "10px",
        position: "relative",
        // The blur below makes this a stacking context, so the pinned panel
        // cannot lift itself above the sidebar from in here - the rail as a
        // whole has to sit above it instead.
        zIndex: 45,
        // A skin that inverts the rail against the window needs no rule
        // between the two - navy meeting white is already an edge, and the
        // pack's hairline is drawn in the window's border colour, which over
        // the rail reads as a pale seam stuck to it.
        borderRight: stencil
          ? "none"
          : "var(--nebula-line-width, 1px) solid " + theme.palette.nebula.line,
        background: theme.palette.nebula.rail,
        ...frost(theme, 14),
      })}
    >
      {/* The artboard rules the rail off from the window with a run of gold
          dashes rather than a hairline - the same warning-tape mark it puts
          over the conversation, and the one thing that stops a navy column
          reading as a shadow of the window behind it. Leaning, because every
          other edge in this skin leans. */}
      {stencil && (
        <Box
          aria-hidden
          sx={(theme) => ({
            position: "absolute",
            // Off the edge rather than on it: run flush to the top and the
            // band reads as the window's own trim rather than the rail's.
            top: 10,
            left: 0,
            right: 0,
            height: 6,
            background: `repeating-linear-gradient(115deg, ${theme.palette.nebula.accent2} 0 8px, transparent 8px 16px)`,
          })}
        />
      )}

      <RailButton label={expanded ? t("servers.collapse") : t("servers.pinOpen")} onClick={onToggleExpanded}>
        {/* A ring rather than an arrow, and it does not turn: the artboard
            draws the expander as the open arc it uses for anything in
            progress, and half a turn of a circle says nothing anyway. */}
        {stencil ? (
          <StencilExpander />
        ) : (
          <ChevronRightIcon
            width={15}
            height={15}
            style={{ transform: expanded ? "rotate(180deg)" : "none" }}
          />
        )}
      </RailButton>

      <RailDivider />

      {/* Friends sits between the expander and the servers, fenced off from
          both: it is a place to go, not a server to switch to, and the two
          would otherwise read as one list. */}
      {friends && (
        <>
          <FriendsTile {...friends} />
          <RailDivider />
        </>
      )}

      {entries.map((entry) => (
        <MakeRoom
          key={entry.group.key}
          offset={tileGaps?.get(entry.group.key)}
          animate={dragKey !== null}
        >
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
            onContextMenu={(x, y) => openMenu(entry, x, y)}
            onHover={(top) => {
              if (dragKey) return;
              show(entry.group.key, top);
            }}
            onLeave={closeSoon}
            onDragPointerDown={beginGesture(entry.group.key)}
          />
        </MakeRoom>
      ))}

      {ghost}

      <RailButton label={t("servers.add")} onClick={onAddServer} dashed>
        <PlusIcon width={15} height={15} />
      </RailButton>

      {stencil && (
        <Box
          aria-hidden
          sx={(theme) => ({
            mt: "auto",
            mb: "4px",
            writingMode: "vertical-rl",
            fontStyle: "italic",
            fontWeight: 700,
            fontSize: 10,
            letterSpacing: ".26em",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
            color: theme.palette.nebula.railDim,
          })}
        >
          {BRAND_WORDMARK}
        </Box>
      )}

      {onDisconnect && (
        <RailButton
          label={t("servers.disconnect")}
          onClick={onDisconnect}
          tone="bad"
          // The label above already took the slack; a second `auto` margin
          // here would split it and leave the two floating apart.
          atBottom={!stencil}
        >
          <LogOutIcon width={15} height={15} />
        </RailButton>
      )}

      {/* The pinned panel says everything the card would, so the two never
          show together. */}
      {/* `mounted` rather than `open`: a panel still sliding out is a panel,
          and a card opening behind it would be the second of the two. */}
      {!mounted && !menu && hoveredEntry && hovered && (
        <ServerRailCard
          entry={hoveredEntry}
          icon={icons?.get(hoveredEntry.group.key)}
          banner={banners?.get(hoveredEntry.group.key)}
          ping={pings?.get(hoveredEntry.group.key)}
          channelName={hoveredEntry.group.key === activeKey ? activeChannelName : null}
          ownName={ownName}
          occupants={hoveredEntry.group.key === activeKey ? occupants : []}
          top={hovered.at}
          onOpen={() => {
            dismiss();
            onSelect(hoveredEntry);
          }}
          onCancel={onCancelConnect ? () => onCancelConnect(hoveredEntry) : undefined}
          onPointerEnter={holdOpen}
          onPointerLeave={closeSoon}
        />
      )}

      {mounted && panel}
      {serverMenu}
    </Box>
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
          borderRadius: radius("rail"),
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
  const plated = tone === "bad" && useTheme().palette.nebulaSkin.chrome === "stencil";
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
          borderRadius: radius("rail"),
          // A drawn skin stands the destructive control on a plate of its own
          // rather than leaving it a loose red glyph at the foot of the rail:
          // everything else down there is bordered, and the one control that
          // ends a session should not be the one that reads as decoration.
          border: dashed
            ? "1px dashed " + theme.palette.nebula.line2
            : plated
              ? `2px solid ${theme.palette.nebula.bad}`
              : "var(--nebula-line-width, 1px) solid transparent",
          background: plated ? alpha(theme.palette.nebula.bad, 0.14) : undefined,
          color: tone === "bad" ? theme.palette.nebula.bad : theme.palette.nebula.railDim,
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
