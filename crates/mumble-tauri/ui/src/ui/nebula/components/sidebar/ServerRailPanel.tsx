import { Box, Typography } from "@mui/material";
import type { ServerPingResult } from "@core/types";
import { CloseIcon, PlusIcon } from "@ui/icons";
import { serverTint, type ServerRailEntry } from "../../selectors";
import { UserAvatar } from "../primitives";
import { radius } from "../../tokens";

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
  onClose: () => void;
  onSelect: (entry: ServerRailEntry) => void;
  onAddServer: () => void;
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
  entry: ServerRailEntry,
  ping: ServerPingResult | undefined,
  activeChannelName: string | null | undefined,
): string {
  if (entry.status === "connecting") return "connecting…";

  const parts: string[] = [];
  const heads = occupancy(ping);
  if (entry.status === "connected") {
    if (heads) parts.push(heads);
    if (ping?.latency_ms != null) parts.push(ping.latency_ms + " ms");
    if (activeChannelName) parts.push("in #" + activeChannelName);
    return parts.length > 0 ? parts.join(" · ") : "connected";
  }

  parts.push(heads ? heads + " online" : "offline");
  const count = entry.group.identities.length;
  if (count > 0) parts.push(count + (count === 1 ? " identity" : " identities"));
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
  onSelect,
}: Readonly<{
  entry: ServerRailEntry;
  active: boolean;
  icon?: string;
  banner?: string;
  ping?: ServerPingResult;
  activeChannelName?: string | null;
  onSelect: () => void;
}>) {
  const { group, status, unread } = entry;
  const meta = subtitle(entry, ping, activeChannelName);

  return (
    <Box
      component="button"
      type="button"
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
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
          px: "10px",
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
              color:
                status === "connecting" ? theme.palette.nebula.warn : theme.palette.nebula.dim,
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
 * The rail, pinned open.
 *
 * It covers the sidebar rather than pushing it aside: the panel is a thing you
 * open, glance at and close, and shifting the whole window sideways for that
 * would cost more than it tells you.
 */
export function ServerRailPanel({
  entries,
  activeKey,
  icons,
  banners,
  pings,
  activeChannelName,
  onClose,
  onSelect,
  onAddServer,
}: Readonly<ServerRailPanelProps>) {
  return (
    <Box
      aria-label="Servers"
      data-testid="nebula-server-rail-panel"
      sx={(theme) => ({
        position: "absolute",
        left: 0,
        top: 0,
        bottom: 0,
        width: 266,
        zIndex: 45,
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        px: "9px",
        py: "10px",
        background: theme.palette.nebula.tint + "," + theme.palette.nebula.bg0,
        borderRight: "1px solid " + theme.palette.nebula.line2,
        boxShadow: "34px 0 70px rgba(2,6,18,.5)",
      })}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: "9px", px: "6px", pt: "5px", pb: "8px" }}>
        <Box
          component="button"
          type="button"
          aria-label="Collapse the server list"
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
        <Typography sx={{ fontSize: 12, fontWeight: 600 }}>Servers</Typography>
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

      {entries.map((entry) => (
        <PanelRow
          key={entry.group.key}
          entry={entry}
          active={entry.group.key === activeKey}
          icon={icons?.get(entry.group.key)}
          banner={banners?.get(entry.group.key)}
          ping={pings?.get(entry.group.key)}
          activeChannelName={activeChannelName}
          onSelect={() => onSelect(entry)}
        />
      ))}

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
        Add a server
      </Box>

      <Typography sx={(theme) => ({ mt: "auto", px: "6px", pb: "4px", fontSize: 10, color: theme.palette.nebula.dim })}>
        Hover a tile for the same card without pinning
      </Typography>
    </Box>
  );
}
