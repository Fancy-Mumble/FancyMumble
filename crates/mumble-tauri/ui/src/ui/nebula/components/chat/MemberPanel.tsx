import { useTranslation } from "react-i18next";
import { Box, IconButton, Typography } from "@mui/material";
import type { UserEntry } from "@core/types";
import { CloseIcon, InfoIcon, MicIcon } from "@ui/icons";
import {
  PriorityBadge,
  RoleChip,
  SearchBox,
  SectionLabel,
  TalkingBars,
  UserAvatar,
  VoiceStateBadges,
  Stack,
} from "../primitives";
import { MenuCheckBox } from "../sidebar/MenuCheckBox";
import type { RosterGroup, RosterMember } from "../../selectors";
import { radius } from "../../tokens";

interface MemberPanelProps {
  /** The roster already split into its groups; see `rosterGroups`. */
  groups: readonly RosterGroup[];
  query: string;
  onQueryChange: (query: string) => void;
  talkingSessions: ReadonlySet<number>;
  ownSession: number | null;
  /** Whether the server's registered-but-absent people are drawn. */
  showOffline: boolean;
  onShowOfflineChange: (next: boolean) => void;
  /** True while the registration table is still on its way. */
  offlineLoading?: boolean;
  onSelect: (session: number, event: React.MouseEvent) => void;
  onHover: (session: number, event: React.MouseEvent) => void;
  onLeave: () => void;
  /** Right-click on a member row. */
  onContextMenu?: (user: UserEntry, event: React.MouseEvent) => void;
  /** The (i) at the end of a channel row: open the User Information sheet. */
  onInfo?: (session: number) => void;
  onClose: () => void;
}

/**
 * The optional right-hand roster, opened from the channel menu.
 *
 * The list answers two questions in one scroll. The channel you are reading
 * comes first, because "who can hear me" is asked while someone is talking and
 * should not cost a click; everyone else follows under the server's own roles,
 * because "who is this server" is answered by its structure rather than by an
 * alphabet. A person in both places is drawn in both places - the admin in your
 * channel is two different facts, and making the reader pick one answers
 * neither.
 *
 * Which half a row is in decides what it says at its right edge: in the channel
 * it is live voice state, everywhere else it is where that person is instead.
 */
export function MemberPanel({
  groups,
  query,
  onQueryChange,
  talkingSessions,
  ownSession,
  showOffline,
  onShowOfflineChange,
  offlineLoading = false,
  onSelect,
  onHover,
  onLeave,
  onContextMenu,
  onInfo,
  onClose,
}: Readonly<MemberPanelProps>) {
  const { t } = useTranslation(["nebulaChat", "sidebar", "nebulaChrome"]);

  // Spelled out rather than looked up by key: the catalogue is typed, and a
  // heading built from a template literal is a key TypeScript cannot check.
  const heading = (group: RosterGroup): string => {
    const count = group.members.length;
    if (group.kind === "channel") return t("nebulaChat:members.groupChannel", { count });
    if (group.kind === "members") return t("nebulaChat:members.groupMembers", { count });
    if (group.kind === "guests") return t("nebulaChat:members.groupGuests", { count });
    return t("nebulaChat:members.groupRole", { role: group.label, count });
  };

  /** The chip beside a heading: the role, in the colour the server gave it. */
  const chip = (group: RosterGroup): string => {
    if (group.kind === "members") return t("sidebar:membersTab.groupMembers");
    if (group.kind === "guests") return t("sidebar:membersTab.groupGuests");
    return group.label;
  };

  return (
    <Stack
      component="aside"
      aria-label={t("sidebar:sidebarTabs.members")}
      sx={(theme) => ({
        width: 264,
        flex: "none",
        minHeight: 0,
        borderLeft: `1px solid ${theme.palette.nebula.line}`,
        background: theme.palette.nebula.panel,
      })}
    >
      <Stack direction="row" alignItems="center" sx={{ px: "14px", pt: "14px", pb: "8px" }}>
        <Typography sx={{ fontSize: 15, fontWeight: 600 }}>{t("sidebar:sidebarTabs.members")}</Typography>
        <IconButton
          size="small"
          aria-label={t("nebulaChat:members.close")}
          sx={{ ml: "auto" }}
          onClick={onClose}
        >
          <CloseIcon width={13} height={13} />
        </IconButton>
      </Stack>

      <Box sx={{ px: "12px", pb: "6px" }}>
        <SearchBox value={query} onChange={onQueryChange} placeholder={t("nebulaChat:members.find")} />
      </Box>

      <Stack
        component="button"
        direction="row"
        alignItems="center"
        gap={0.875}
        role="checkbox"
        aria-checked={showOffline}
        onClick={() => onShowOfflineChange(!showOffline)}
        sx={(theme) => ({
          // `all: unset` also drops the flex layout Stack applies, so the row
          // has to restate it or the tick box and its label collide.
          all: "unset",
          display: "flex",
          alignItems: "center",
          gap: "7px",
          boxSizing: "border-box",
          cursor: "pointer",
          mx: "12px",
          mb: "8px",
          px: "8px",
          py: "5px",
          borderRadius: radius("md"),
          fontSize: 11.5,
          color: theme.palette.nebula.muted,
          "&:hover": { background: theme.palette.nebula.hover },
        })}
      >
        <MenuCheckBox checked={showOffline} />
        {t("nebulaChat:members.showOffline")}
      </Stack>

      <Box sx={(theme) => ({ height: "1px", background: theme.palette.nebula.line })} />

      <Box sx={{ flex: 1, overflowY: "auto", minHeight: 0, p: "4px 8px" }}>
        {groups.map((group) => (
          <Box component="section" key={group.key} sx={{ pb: "6px" }}>
            <Stack
              direction="row"
              alignItems="center"
              gap={0.75}
              // A role is named by whoever runs the server, so the heading
              // clips rather than widening the panel past its column.
              sx={{ px: "8px", pt: "8px", pb: "4px", minWidth: 0, overflow: "hidden" }}
            >
              {group.kind === "channel" ? (
                <Box
                  component="span"
                  aria-hidden
                  sx={(theme) => ({ display: "flex", color: theme.palette.nebula.accent })}
                >
                  <MicIcon width={11} height={11} />
                </Box>
              ) : (
                <RoleChip name={chip(group)} color={group.color} size="small" />
              )}
              <SectionLabel
                component="h3"
                id={`nebula-roster-${group.key}`}
                sx={(theme) => ({
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.07em",
                  lineHeight: 1.4,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  color:
                    group.kind === "channel" ? theme.palette.nebula.accent : theme.palette.nebula.dim,
                })}
              >
                {heading(group)}
              </SectionLabel>
            </Stack>
            <Box
              component="ul"
              aria-labelledby={`nebula-roster-${group.key}`}
              sx={{ listStyle: "none", m: 0, p: 0 }}
            >
              {group.members.map((member) => (
                <MemberRow
                  key={member.user.session}
                  member={member}
                  inChannel={group.kind === "channel"}
                  own={member.user.session === ownSession}
                  talking={talkingSessions.has(member.user.session)}
                  onSelect={onSelect}
                  onHover={onHover}
                  onLeave={onLeave}
                  onContextMenu={onContextMenu}
                  onInfo={onInfo}
                />
              ))}
            </Box>
          </Box>
        ))}

        {offlineLoading && showOffline && (
          <Typography
            role="status"
            aria-live="polite"
            sx={(theme) => ({ px: "8px", py: "6px", fontSize: 11, color: theme.palette.nebula.dim })}
          >
            {t("nebulaChat:members.offlineLoading")}
          </Typography>
        )}
      </Box>
    </Stack>
  );
}

interface MemberRowProps {
  member: RosterMember;
  /** Drawn under the open channel's heading rather than under a role. */
  inChannel: boolean;
  own: boolean;
  talking: boolean;
  onSelect: (session: number, event: React.MouseEvent) => void;
  onHover: (session: number, event: React.MouseEvent) => void;
  onLeave: () => void;
  onContextMenu?: (user: UserEntry, event: React.MouseEvent) => void;
  onInfo?: (session: number) => void;
}

/**
 * One person, twice over.
 *
 * Under the channel heading the trailing slot carries live voice state - the
 * badges, the meter and the way into the information sheet - because that is
 * what a row about someone you are talking to is for. Under a role it carries
 * where they are instead, which is the only thing worth knowing about someone
 * who is not in the room with you.
 */
function MemberRow({
  member,
  inChannel,
  own,
  talking,
  onSelect,
  onHover,
  onLeave,
  onContextMenu,
  onInfo,
}: Readonly<MemberRowProps>) {
  const { t } = useTranslation(["nebulaChat", "nebulaChrome"]);
  const { user, offline } = member;

  return (
    <Stack
      component="li"
      direction="row"
      alignItems="center"
      gap={1.125}
      onClick={offline ? undefined : (event) => onSelect(user.session, event)}
      onMouseEnter={offline ? undefined : (event) => onHover(user.session, event)}
      onMouseLeave={offline ? undefined : onLeave}
      onContextMenu={onContextMenu && !offline ? (event) => onContextMenu(user, event) : undefined}
      sx={(theme) => ({
        px: "8px",
        py: "6px",
        borderRadius: radius("md"),
        cursor: offline ? "default" : "pointer",
        opacity: offline ? 0.6 : 1,
        minWidth: 0,
        "&:hover": { background: offline ? "transparent" : theme.palette.nebula.hover },
      })}
    >
      <UserAvatar
        name={user.name}
        session={user.session}
        textureSize={user.texture_size}
        size={24}
        talking={inChannel && talking}
        // The pip answers a question the channel section has already answered:
        // everyone under that heading is here, by definition.
        status={inChannel ? undefined : offline ? "offline" : "online"}
      />
      <Typography sx={{ fontSize: 12.5, minWidth: 0 }} noWrap>
        {user.name}
      </Typography>
      {own && (
        <Typography
          sx={(theme) => ({ fontSize: 9.5, flex: "none", color: theme.palette.nebula.dim })}
        >
          {t("nebulaChrome:miniMode.you")}
        </Typography>
      )}
      {inChannel && <PriorityBadge user={user} />}

      {inChannel ? (
        <Stack direction="row" alignItems="center" gap={0.75} sx={{ ml: "auto", flex: "none" }}>
          <VoiceStateBadges user={user} />
          <TalkingBars talking={talking} />
          {onInfo && (
            <IconButton
              size="small"
              aria-label={t("nebulaChat:members.info", { name: user.name })}
              // The row itself opens the card; this opens the sheet instead.
              onClick={(event) => {
                event.stopPropagation();
                onInfo(user.session);
              }}
              sx={(theme) => ({ p: "2px", color: theme.palette.nebula.dim, flex: "none" })}
            >
              <InfoIcon width={13} height={13} />
            </IconButton>
          )}
        </Stack>
      ) : (
        member.channel && (
          <Typography
            title={t("nebulaChat:members.whereChannel", { channel: member.channel })}
            sx={(theme) => ({
              ml: "auto",
              maxWidth: "45%",
              fontSize: 11,
              color: theme.palette.nebula.dim,
            })}
            noWrap
          >
            #{member.channel}
          </Typography>
        )
      )}
    </Stack>
  );
}
