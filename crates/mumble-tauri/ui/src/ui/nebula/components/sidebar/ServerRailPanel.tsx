import { Fragment, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Box, IconButton, Tooltip, Typography } from "@mui/material";
import type { ServerPingResult } from "@core/types";
import { CloseIcon, PlusIcon, StarIcon, UsersGroupIcon } from "@ui/icons";
import { serverTint, type ServerGroup, type ServerRailEntry } from "../../selectors";
import { UserAvatar } from "../primitives";
import { radius } from "../../tokens";

/**
 * The Friends destination, when the server list is the one carrying it.
 *
 * Absent while the title bar has the tab strip: Friends sits up there instead,
 * and two of it on screen would be one too many. `unread` is every waiting
 * direct message, summed - there is one entry for the destination, not one per
 * conversation, so what it can say is that something is waiting.
 *
 * Declared here rather than in `ServerRail` because the rail already imports
 * this module; putting it the other way round would make the two circular.
 */
export interface RailFriends {
  /** True while the Friends screen is the one open. */
  active: boolean;
  unread: number;
  onOpen: () => void;
}

interface ServerRailPanelProps {
  entries: readonly ServerRailEntry[];
  activeKey: string | null;
  /** Server artwork, keyed by host:port. */
  icons?: ReadonlyMap<string, string>;
  banners?: ReadonlyMap<string, string>;
  /** Occupancy and latency, keyed the same way. */
  pings?: ReadonlyMap<string, ServerPingResult>;
  /** Where you are on the server you are connected to. */
  activeChannelName?: string | null;
  /** The tile being carried, and the row it would land in front of. */
  dragKey?: string | null;
  dropBefore?: string | null;
  registerRowRef?: (key: string, element: HTMLElement | null) => void;
  onRowPointerDown?: (key: string) => (event: React.PointerEvent<HTMLElement>) => void;
  /**
   * Pinned open as the screen's own column rather than floating over one.
   *
   * The connect screen has no second list to cover, so there the panel *is*
   * the sidebar: it takes its own space, keeps the search field, and has
   * nothing to collapse back into.
   */
  pinned?: boolean;
  /** The field that filters the rows, supplied by whoever owns the query. */
  search?: ReactNode;
  /** Shown in place of the rows when there are none - see `ServerRail`. */
  empty?: ReactNode;
  /** Absent while the panel floats: there is then no room to collapse into. */
  onClose?: () => void;
  /**
   * Friends, when the title bar is not carrying it.
   *
   * Pinned, this panel *is* the sidebar - the column of tiles gives way to it -
   * so the destination the rail would have drawn has to be reachable from in
   * here too, or the connect screen loses its way to Friends entirely.
   */
  friends?: RailFriends;
  onSelect: (entry: ServerRailEntry) => void;
  onAddServer: () => void;
  /** Absent where favouriting is not offered; the star is then not drawn. */
  onToggleFavorite?: (group: ServerGroup) => void;
}

/** Friends, as a row of the open list. Shaped like a server row, minus the
 *  avatar: it is a destination rather than a place to connect to. */
/** The namespaces this panel reads, so `subtitle` can take the same `t`. */
const PANEL_NS = ["nebulaSidebar", "nebulaConnect", "server"] as const;
type PanelT = ReturnType<typeof useTranslation<typeof PANEL_NS>>["t"];

function FriendsRow({ active, unread, onOpen }: Readonly<RailFriends>) {
  const { t } = useTranslation(PANEL_NS);
  return (
    <Box
      component="button"
      type="button"
      aria-current={active ? "true" : undefined}
      onClick={onOpen}
      sx={(theme) => ({
        all: "unset",
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        gap: "9px",
        px: "10px",
        py: "9px",
        cursor: "pointer",
        borderRadius: radius("lg"),
        background: active ? theme.palette.nebula.card2 : "transparent",
        color: active ? theme.palette.nebula.text : theme.palette.nebula.muted,
        "&:hover": { background: theme.palette.nebula.hover, color: theme.palette.nebula.text },
        "&:focus-visible": { outline: "2px solid " + theme.palette.nebula.accent, outlineOffset: 2 },
      })}
    >
      <UsersGroupIcon width={16} height={16} />
      <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{t("server:tabsBar.friends")}</Typography>
      {unread > 0 && (
        <Box
          aria-label={t("server:tabsBar.unreadCount", { count: unread })}
          sx={(theme) => ({
            ml: "auto",
            minWidth: 18,
            height: 18,
            px: "5px",
            borderRadius: "9px",
            display: "grid",
            placeItems: "center",
            background: theme.palette.nebula.bad,
            color: theme.palette.nebula.bg0,
            fontSize: 10,
            fontWeight: 700,
            fontVariantNumeric: "tabular-nums",
          })}
        >
          {unread > 99 ? "99+" : unread}
        </Box>
      )}
    </Box>
  );
}

/** Where the carried row would land, drawn without moving anything. */
function DropLine() {
  return (
    <Box
      aria-hidden
      sx={(theme) => ({
        height: 2,
        my: "-1px",
        mx: "2px",
        flex: "none",
        borderRadius: "1px",
        background: theme.palette.nebula.accent,
      })}
    />
  );
}

/** How many people are on, in the form the mock prints it. */
function occupancy(ping: ServerPingResult | undefined): string | null {
  if (!ping?.online) return null;
  const max = ping.max_user_count ? "/" + ping.max_user_count : "";
  return (ping.user_count ?? 0) + max;
}

/**
 * The line under a server name.
 *
 * Each state answers a different question, so none of them shares a shape: a
 * server being reached says only that, one you are on says where you are, and
 * one you are merely keeping says how busy it is and how many logins you have
 * for it.
 */
function subtitle(
  t: PanelT,
  entry: ServerRailEntry,
  ping: ServerPingResult | undefined,
  activeChannelName: string | null | undefined,
): string {
  if (entry.status === "connecting") return t("nebulaSidebar:servers.connecting");

  const parts: string[] = [];
  const heads = occupancy(ping);
  if (entry.status === "connected") {
    if (heads) parts.push(heads);
    if (ping?.latency_ms != null) parts.push(t("nebulaConnect:status.latency", { ms: ping.latency_ms }));
    if (activeChannelName) parts.push(t("nebulaSidebar:servers.inChannel", { channel: activeChannelName }));
    return parts.length > 0 ? parts.join(" · ") : t("nebulaSidebar:servers.connected");
  }

  parts.push(
    heads
      ? ping?.max_user_count
        ? t("nebulaConnect:status.onlineOfMax", {
            users: ping.user_count ?? 0,
            max: ping.max_user_count,
          })
        : t("nebulaConnect:status.online", { users: ping?.user_count ?? 0 })
      : t("nebulaConnect:status.offline"),
  );
  const count = entry.group.identities.length;
  if (count > 0) parts.push(t("nebulaSidebar:servers.identities", { count }));
  return parts.join(" · ");
}
/**
 * One server in the panel.
 *
 * The server you are on is the only row that gets its banner, which is what
 * makes it findable at a glance without a second colour or a label saying so.
 */
function PanelRow({
  entry,
  active,
  icon,
  banner,
  ping,
  activeChannelName,
  dragging,
  registerRef,
  onPointerDown,
  onSelect,
  ghost = false,
  reserveTrailing = false,
}: Readonly<{
  entry: ServerRailEntry;
  active: boolean;
  icon?: string;
  banner?: string;
  ping?: ServerPingResult;
  activeChannelName?: string | null;
  dragging?: boolean;
  registerRef?: (element: HTMLElement | null) => void;
  onPointerDown?: (event: React.PointerEvent<HTMLElement>) => void;
  onSelect: () => void;
  /** Drawn as the thing under the pointer rather than as a control. */
  ghost?: boolean;
  /** Keeps the right edge clear for the star drawn over the row. */
  reserveTrailing?: boolean;
}>) {
  const { t } = useTranslation(PANEL_NS);
  const { group, status, unread } = entry;
  const meta = subtitle(t, entry, ping, activeChannelName);

  return (
    <Box
      component={ghost ? "div" : "button"}
      type={ghost ? undefined : "button"}
      ref={ghost ? undefined : registerRef}
      onClick={ghost ? undefined : onSelect}
      onPointerDown={
        ghost
          ? undefined
          : (event: React.PointerEvent<HTMLElement>) => {
              // The banner and the icon are both images, which the browser would
              // rather drag than let the row own the gesture.
              event.preventDefault();
              onPointerDown?.(event);
            }
      }
      aria-current={ghost || !active ? undefined : "true"}
      sx={(theme) => ({
        all: "unset",
        boxSizing: "border-box",
        display: "block",
        width: "100%",
        cursor: "pointer",
        borderRadius: radius("lg"),
        overflow: "hidden",
        background: active ? theme.palette.nebula.accentSoft : theme.palette.nebula.card,
        border: "1px solid " + (active ? theme.palette.nebula.accentLine : theme.palette.nebula.line2),
        "&:hover": { borderColor: theme.palette.nebula.accentLine },
        "&:focus-visible": { outline: "2px solid " + theme.palette.nebula.accent, outlineOffset: 2 },
        opacity: dragging ? 0.4 : 1,
        userSelect: "none",
        touchAction: "none",
        "& img": { WebkitUserDrag: "none", pointerEvents: "none" },
      })}
    >
      {active && banner && (
        <Box sx={{ height: 54, position: "relative", overflow: "hidden" }}>
          <Box
            component="img"
            src={banner}
            alt=""
            sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block", opacity: 0.7 }}
          />
          <Box
            aria-hidden
            sx={(theme) => ({
              position: "absolute",
              inset: 0,
              background: "linear-gradient(180deg,transparent," + theme.palette.nebula.bg0 + ")",
            })}
          />
        </Box>
      )}
      <Box
        sx={{
          display: "flex",
          alignItems: active && banner ? "flex-end" : "center",
          gap: "10px",
          pl: "10px",
          // The star is drawn over the row rather than inside it - a button
          // cannot hold another - so the row has to leave it the room.
          pr: reserveTrailing ? "34px" : "10px",
          py: active && banner ? 0 : "9px",
          pb: active && banner ? "11px" : "9px",
          mt: active && banner ? "-16px" : 0,
          position: "relative",
        }}
      >
        <UserAvatar name={group.label} size={34} square src={icon} gradient={serverTint(group.key)} />
        <Box sx={{ minWidth: 0, flex: 1, textAlign: "left" }}>
          <Typography noWrap sx={{ fontSize: 12.5, fontWeight: active ? 600 : 500 }}>
            {group.label}
          </Typography>
          <Typography
            noWrap
            sx={(theme) => ({
              fontSize: 10,
              mt: "2px",
              color: status === "connecting" ? theme.palette.nebula.warn : theme.palette.nebula.dim,
            })}
          >
            {meta}
          </Typography>
        </Box>
        {unread > 0 && (
          <Box
            sx={(theme) => ({
              flex: "none",
              minWidth: 17,
              height: 17,
              px: "4px",
              borderRadius: "9px",
              display: "grid",
              placeItems: "center",
              background: theme.palette.nebula.bad,
              color: theme.palette.nebula.bg0,
              fontSize: 9,
              fontWeight: 700,
              fontVariantNumeric: "tabular-nums",
            })}
          >
            {unread > 99 ? "99+" : unread}
          </Box>
        )}
      </Box>
    </Box>
  );
}

/**
 * The favourite mark, drawn over its row.
 *
 * Outside the row rather than inside it because the row is a button, and a
 * button cannot hold a second one. It stays invisible until the row is hovered
 * or it is carrying state, so a resting list is a list of servers rather than a
 * column of stars.
 */
function FavouriteStar({
  group,
  onToggle,
}: Readonly<{ group: ServerGroup; onToggle: (group: ServerGroup) => void }>) {
  const { t } = useTranslation("server");
  const label = group.favorite ? t("list.removeFromFavorites") : t("list.addToFavorites");
  return (
    <Tooltip title={label}>
      <IconButton
        size="small"
        className="nebula-fav"
        aria-label={label}
        aria-pressed={group.favorite}
        onClick={() => onToggle(group)}
        sx={(theme) => ({
          position: "absolute",
          right: "6px",
          // Measured from the bottom so the star lands on the name in both row
          // shapes: the open server's row is taller and bottom-aligned under
          // its banner, and a centred star would sit in the artwork.
          bottom: "13px",
          opacity: group.favorite ? 1 : 0,
          color: group.favorite ? theme.palette.nebula.warn : theme.palette.nebula.dim,
          "&:focus-visible": { opacity: 1 },
        })}
      >
        <StarIcon width={13} height={13} fill={group.favorite ? "currentColor" : "none"} />
      </IconButton>
    </Tooltip>
  );
}
/**
 * The rail, pinned open.
 *
 * Opened from the rail it covers the sidebar rather than pushing it aside: the
 * panel is a thing you open, glance at and close, and shifting the whole window
 * sideways for that would cost more than it tells you.
 *
 * `pinned` is the other life. On the connect screen there is no second list for
 * it to cover - the sidebar there listed the same servers this does - so the
 * panel takes that column outright, search field and all, and the two lists
 * that used to disagree about what they were for become one.
 */
export function ServerRailPanel({
  entries,
  activeKey,
  icons,
  banners,
  pings,
  activeChannelName,
  dragKey,
  dropBefore,
  registerRowRef,
  onRowPointerDown,
  pinned = false,
  search,
  empty,
  onClose,
  friends,
  onSelect,
  onAddServer,
  onToggleFavorite,
}: Readonly<ServerRailPanelProps>) {
  const { t } = useTranslation(PANEL_NS);
  return (
    <Box
      component={pinned ? "nav" : "div"}
      aria-label={t("nebulaSidebar:servers.title")}
      data-testid="nebula-server-rail-panel"
      sx={(theme) => ({
        // Pinned it is a column of the window, so it takes part in the layout;
        // floating it is laid over one, anchored to the rail it came out of.
        ...(pinned
          ? { position: "relative", flex: "none", minHeight: 0 }
          : { position: "absolute", left: 0, top: 0, bottom: 0, zIndex: 45 }),
        // The sidebar's width when it is the sidebar, so the pane beside it
        // does not shift as the user moves between screens.
        width: pinned ? 290 : 266,
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        px: "9px",
        py: "10px",
        background: pinned
          ? theme.palette.nebula.panel
          : theme.palette.nebula.tint + "," + theme.palette.nebula.bg0,
        borderRight: "1px solid " + (pinned ? theme.palette.nebula.line : theme.palette.nebula.line2),
        // Nothing is underneath it to cast onto.
        boxShadow: pinned ? "none" : "34px 0 70px rgba(2,6,18,.5)",
      })}
    >
      {/* Friends above the servers and fenced off from them: it is a place to
          go, not a server to switch to. */}
      {friends && (
        <>
          <FriendsRow {...friends} />
          <Box
            aria-hidden
            sx={(theme) => ({
              height: "1px",
              mx: "6px",
              my: "5px",
              background: theme.palette.nebula.line2,
            })}
          />
        </>
      )}

      <Box sx={{ display: "flex", alignItems: "center", gap: "9px", px: "6px", pt: "5px", pb: "8px" }}>
        {onClose && (
          <Box
            component="button"
            type="button"
            aria-label={t("nebulaSidebar:servers.collapse")}
            onClick={onClose}
            sx={(theme) => ({
              all: "unset",
              width: 30,
              height: 30,
              flex: "none",
              display: "grid",
              placeItems: "center",
              cursor: "pointer",
              borderRadius: radius("md"),
              background: theme.palette.nebula.card2,
              color: theme.palette.nebula.text,
              "&:focus-visible": { outline: "2px solid " + theme.palette.nebula.accent, outlineOffset: 2 },
            })}
          >
            <CloseIcon width={15} height={15} />
          </Box>
        )}
        <Typography sx={{ fontSize: pinned ? 15 : 12, fontWeight: 600 }}>
          {t("nebulaSidebar:servers.title")}
        </Typography>
        <Box
          component="button"
          type="button"
          onClick={onAddServer}
          sx={(theme) => ({
            all: "unset",
            ml: "auto",
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 500,
            color: theme.palette.nebula.accent,
            "&:focus-visible": { outline: "2px solid " + theme.palette.nebula.accent, outlineOffset: 2 },
          })}
        >
          + Add
        </Box>
      </Box>

      {search && <Box sx={{ pb: "4px" }}>{search}</Box>}

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: "4px",
        }}
      >
        {entries.map((entry) => (
          <Fragment key={entry.group.key}>
            {dropBefore === entry.group.key && <DropLine />}
            <Box sx={{ position: "relative", "&:hover .nebula-fav": { opacity: 1 } }}>
              <PanelRow
                entry={entry}
                active={entry.group.key === activeKey}
                icon={icons?.get(entry.group.key)}
                banner={banners?.get(entry.group.key)}
                ping={pings?.get(entry.group.key)}
                activeChannelName={activeChannelName}
                dragging={dragKey === entry.group.key}
                reserveTrailing={Boolean(onToggleFavorite)}
                registerRef={(element) => registerRowRef?.(entry.group.key, element)}
                onPointerDown={onRowPointerDown?.(entry.group.key)}
                onSelect={() => {
                  if (dragKey) return;
                  onSelect(entry);
                }}
              />
              {onToggleFavorite && <FavouriteStar group={entry.group} onToggle={onToggleFavorite} />}
            </Box>
          </Fragment>
        ))}
        {dragKey && dropBefore === null && <DropLine />}

        {entries.length === 0 && empty && (
          <Typography
            sx={(theme) => ({ px: "8px", py: "10px", fontSize: 11.5, color: theme.palette.nebula.dim })}
          >
            {empty}
          </Typography>
        )}

        <Box
          component="button"
          type="button"
          onClick={onAddServer}
          sx={(theme) => ({
            all: "unset",
            boxSizing: "border-box",
            display: "flex",
            alignItems: "center",
            gap: "9px",
            px: "10px",
            py: "9px",
            cursor: "pointer",
            borderRadius: radius("lg"),
            border: "1px dashed " + theme.palette.nebula.line2,
            color: theme.palette.nebula.dim,
            fontSize: 11.5,
            "&:hover": { borderColor: theme.palette.nebula.accentLine, color: theme.palette.nebula.accent },
            "&:focus-visible": { outline: "2px solid " + theme.palette.nebula.accent, outlineOffset: 2 },
          })}
        >
          <PlusIcon width={14} height={14} style={{ flex: "none" }} />
          {t("nebulaSidebar:servers.add")}
        </Box>
      </Box>

      {!pinned && (
        <Typography
          sx={(theme) => ({ px: "6px", pt: "6px", pb: "4px", fontSize: 10, color: theme.palette.nebula.dim })}
        >
          {t("nebulaSidebar:servers.hoverHint")}
        </Typography>
      )}
    </Box>
  );
}

/**
 * The panel row, drawn as the thing under the pointer.
 *
 * The same component the panel lists, so a carried row cannot drift from the
 * one it came from - it is the row, minus the parts that make it a control.
 */
export function ServerRailRowGhost({
  entry,
  active,
  icon,
  banner,
  ping,
  activeChannelName,
}: Readonly<{
  entry: ServerRailEntry;
  /** Carried as it looked: the open server keeps its banner. */
  active: boolean;
  icon?: string;
  banner?: string;
  ping?: ServerPingResult;
  activeChannelName?: string | null;
}>) {
  return (
    <PanelRow
      entry={entry}
      active={active}
      icon={icon}
      banner={banner}
      ping={ping}
      activeChannelName={activeChannelName}
      onSelect={() => {}}
      ghost
    />
  );
}
