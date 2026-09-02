import { useTranslation } from "react-i18next";
import { Box, Divider, Menu, MenuItem, Typography } from "@mui/material";
import type { ServerPingResult } from "@core/types";
import { PlusIcon, SearchIcon } from "@ui/icons";
import { formatLastJoined, serverTint, type QuickConnectTarget } from "../../selectors";
import { SectionLabel, StatusDot, UserAvatar, Stack } from "../primitives";
import { radius } from "../../tokens";

interface QuickConnectProps {
  /** The "+" button in the title bar; null while the menu is closed. */
  anchorEl: HTMLElement | null;
  /** Saved logins not already open, most recently joined first. */
  targets: readonly QuickConnectTarget[];
  /** How many servers are saved at all, to tell "none yet" from "all open". */
  savedCount: number;
  /** Ping results keyed by the group's `host:port`. */
  pings: ReadonlyMap<string, ServerPingResult>;
  onClose: () => void;
  onConnect: (target: QuickConnectTarget) => void;
  onAddByAddress: () => void;
  onBrowsePublic: () => void;
}

/**
 * Quick connect: the "+" beside the open tabs.
 *
 * The tab strip answers "where am I"; this answers "where else", and the two
 * belong together - which is why the shortest way to a second server is next to
 * the first rather than back on the connect screen. Each row is one connect: it
 * opens a tab as the identity that address was last used with, and says which
 * one that is when the choice is not obvious. Anything that needs a decision -
 * a new address, an unknown server, a different login - leaves the menu for a
 * surface with room for it.
 */
export function QuickConnect({
  anchorEl,
  targets,
  savedCount,
  pings,
  onClose,
  onConnect,
  onAddByAddress,
  onBrowsePublic,
}: Readonly<QuickConnectProps>) {
  const { t } = useTranslation(["nebulaConnect", "nebulaCommon", "server"]);

  /** `12/50 online`, or just the head count when the server caps at nothing. */
  const occupancy = (ping: ServerPingResult) => {
    const users = ping.user_count ?? 0;
    return ping.max_user_count
      ? t("nebulaConnect:status.onlineOfMax", { users, max: ping.max_user_count })
      : t("nebulaConnect:status.online", { users });
  };

  return (
    <Menu
      open={anchorEl !== null}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      transformOrigin={{ vertical: "top", horizontal: "left" }}
      slotProps={{
        list: { dense: true, sx: { py: "6px", width: 260 }, "aria-label": t("nebulaCommon:quickConnect") },
        paper: { sx: { mt: "6px" } },
      }}
    >
      <SectionLabel sx={{ px: "14px", pt: "4px", pb: "2px" }}>
        {t("nebulaConnect:quickConnect.sectionOpenAsNewTab")}
      </SectionLabel>

      {targets.length === 0 && (
        <Typography
          sx={(theme) => ({ px: "14px", py: "8px", fontSize: 11.5, color: theme.palette.nebula.muted })}
        >
          {savedCount === 0
            ? t("nebulaConnect:quickConnect.noneSaved")
            : t("nebulaConnect:quickConnect.allOpen")}
        </Typography>
      )}

      {targets.map((target) => {
        const { group, identity } = target;
        const ping = pings.get(group.key);
        const joined = formatLastJoined(identity.last_joined ?? null);
        const subtitle = [
          !ping
            ? t("nebulaConnect:status.checkingEllipsis")
            : ping.online
              ? occupancy(ping)
              : t("nebulaConnect:status.offline"),
          joined && t("nebulaConnect:quickConnect.lastJoined", { when: joined }),
          // Only worth saying when the address has a choice of logins: it names
          // the one this row is about to use, which matters most when the other
          // one is the tab you are already sitting in.
          group.identities.length > 1
            ? t("nebulaConnect:quickConnect.asIdentity", { username: identity.username })
            : null,
        ]
          .filter(Boolean)
          .join(" · ");

        return (
          <MenuItem
            key={`${group.key}|${identity.id}`}
            onClick={() => onConnect(target)}
            sx={{ px: "12px", py: "7px" }}
          >
            <Stack direction="row" alignItems="center" gap={1.25} sx={{ width: "100%", minWidth: 0 }}>
              <UserAvatar name={group.label} size={28} square gradient={serverTint(group.key)} />
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography sx={{ fontWeight: 500, fontSize: 12.5 }} noWrap>
                  {group.label}
                </Typography>
                <Typography sx={(theme) => ({ fontSize: 11, color: theme.palette.nebula.muted })} noWrap>
                  {subtitle}
                </Typography>
              </Box>
              {ping?.online && <StatusDot status="online" />}
            </Stack>
          </MenuItem>
        );
      })}

      <Divider sx={{ my: "6px" }} />

      <MenuItem onClick={onAddByAddress} sx={{ px: "12px", py: "7px", gap: 1.25 }}>
        <ActionIcon>
          <PlusIcon width={13} height={13} />
        </ActionIcon>
        <Typography sx={{ fontSize: 12.5 }}>{t("nebulaConnect:quickConnect.addByAddress")}</Typography>
      </MenuItem>

      <MenuItem onClick={onBrowsePublic} sx={{ px: "12px", py: "7px", gap: 1.25 }}>
        <ActionIcon>
          <SearchIcon width={13} height={13} />
        </ActionIcon>
        <Typography sx={{ fontSize: 12.5 }}>{t("server:publicServersLink")}</Typography>
      </MenuItem>
    </Menu>
  );
}


/**
 * The tile an action row wears where a server row wears its avatar, so both
 * kinds of row share one text column.
 */
function ActionIcon({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <Box
      aria-hidden
      sx={(theme) => ({
        width: 28,
        height: 28,
        flex: "none",
        borderRadius: radius("md"),
        display: "grid",
        placeItems: "center",
        background: theme.palette.nebula.card2,
        color: theme.palette.nebula.muted,
      })}
    >
      {children}
    </Box>
  );
}
