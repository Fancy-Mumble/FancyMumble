import { useTranslation } from "react-i18next";
import { Box, IconButton, Tooltip, Typography } from "@mui/material";
import type { ServerPingResult } from "@core/types";
import { StarIcon } from "@ui/icons";
import { serverTint, type ServerGroup } from "../../selectors";
import { UserAvatar, Stack } from "../primitives";
import { radius } from "../../tokens";

interface ServerListProps {
  groups: readonly ServerGroup[];
  /** Ping results keyed by the group's `host:port`. */
  pings: ReadonlyMap<string, ServerPingResult>;
  selectedKey: string | null;
  onSelect: (group: ServerGroup) => void;
  onToggleFavorite: (group: ServerGroup) => void;
}

/**
 * The Servers column: one row per address.
 *
 * A saved "server" is really a saved login, so several rows can share an
 * address; listing them raw shows the same server once per account. The row is
 * the server, its subtitle counts the identities on it, and choosing which one
 * to arrive as belongs to the connect screen.
 */
export function ServerList({
  groups,
  pings,
  selectedKey,
  onSelect,
  onToggleFavorite,
}: Readonly<ServerListProps>) {
  const { t } = useTranslation(["nebulaSidebar", "nebulaConnect", "server"]);
  return (
    <Box
      component="ul"
      sx={{
        flex: 1,
        overflowY: "auto",
        listStyle: "none",
        m: 0,
        p: "4px 8px",
        display: "flex",
        flexDirection: "column",
        gap: "1px",
        minHeight: 0,
      }}
    >
      {groups.map((group) => {
        const active = group.key === selectedKey;
        const ping = pings.get(group.key);
        const identities = t("nebulaSidebar:servers.identities", { count: group.identities.length });
        const presence = !ping
          ? t("nebulaSidebar:servers.checking")
          : ping.online
            ? ping.max_user_count
              ? t("nebulaConnect:status.onlineOfMax", {
                  users: ping.user_count ?? 0,
                  max: ping.max_user_count,
                })
              : t("nebulaConnect:status.online", { users: ping.user_count ?? 0 })
            : t("nebulaConnect:status.offline");

        return (
          <Stack
            component="li"
            key={group.key}
            direction="row"
            alignItems="center"
            gap={1.5}
            onClick={() => onSelect(group)}
            sx={(theme) => ({
              px: "12px",
              py: "11px",
              borderRadius: radius("lg"),
              cursor: "pointer",
              background: active ? theme.palette.nebula.accentSoft : "transparent",
              border: `1px solid ${active ? theme.palette.nebula.accentLine : "transparent"}`,
              "&:hover": {
                background: active ? theme.palette.nebula.accentSoft : theme.palette.nebula.hover,
              },
              "&:hover .nebula-fav": { opacity: 1 },
            })}
          >
            <UserAvatar name={group.label} size={32} square gradient={serverTint(group.key)} />
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography sx={{ fontWeight: active ? 600 : 500, fontSize: 12.5 }} noWrap>
                {group.label}
              </Typography>
              <Typography sx={(theme) => ({ fontSize: 11, color: theme.palette.nebula.muted })} noWrap>
                {group.sessionId ? t("nebulaSidebar:servers.connected") : presence} · {identities}
              </Typography>
            </Box>
            <Tooltip
              title={
                group.favorite
                  ? t("server:list.removeFromFavorites")
                  : t("server:list.addToFavorites")
              }
            >
              <IconButton
                size="small"
                className="nebula-fav"
                aria-label={
                  group.favorite
                    ? t("server:list.removeFromFavorites")
                    : t("server:list.addToFavorites")
                }
                aria-pressed={group.favorite}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleFavorite(group);
                }}
                sx={(theme) => ({
                  flex: "none",
                  // Resting rows stay quiet; the star appears on hover unless it
                  // is already carrying state.
                  opacity: group.favorite ? 1 : 0,
                  color: group.favorite ? theme.palette.nebula.warn : theme.palette.nebula.dim,
                  "&:focus-visible": { opacity: 1 },
                })}
              >
                <StarIcon width={13} height={13} fill={group.favorite ? "currentColor" : "none"} />
              </IconButton>
            </Tooltip>
          </Stack>
        );
      })}
    </Box>
  );
}
