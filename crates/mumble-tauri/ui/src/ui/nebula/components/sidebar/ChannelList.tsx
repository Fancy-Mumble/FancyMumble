import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Box, Tooltip, Typography } from "@mui/material";
import type { Theme } from "@mui/material/styles";
import { parseChannelDescription } from "@core/channelProfile";
import { useChannelDescription } from "@core/lazyBlobs";
import type { ChannelEntry, UserEntry } from "@core/types";
import { LockIcon, VolumeIcon } from "@ui/icons";
import { groupOccupants, type OrderedChannel } from "../../selectors";
import { useChannelViewer, type NebulaChannelViewer } from "../../useChannelViewer";
import {
  PriorityBadge,
  SectionLabel,
  StatusDot,
  TalkingBars,
  UserAvatar,
  VoiceStateBadges,
  Stack,
} from "../primitives";
import { radius } from "../../tokens";

/** How many faces a channel row shows before it starts counting instead. */
const MAX_STACKED = 5;

interface ChannelListProps {
  channels: readonly OrderedChannel[];
  users: readonly UserEntry[];
  selectedChannel: number | null;
  currentChannel: number | null;
  talkingSessions: ReadonlySet<number>;
  unreadCounts: Record<number, number>;
  ownSession: number | null;
  /**
   * Detached rooms - meetings and invitee-only rooms - which the tree above
   * deliberately never lists. Absent, or empty, and the section is not drawn.
   */
  privateRooms?: readonly ChannelEntry[];
  onSelect: (channel: ChannelEntry) => void;
  onJoin: (channel: ChannelEntry) => void;
  onContextMenu: (channel: ChannelEntry, event: React.MouseEvent) => void;
  onSelectUser: (session: number, event: React.MouseEvent) => void;
  onHoverUser: (session: number, event: React.MouseEvent) => void;
  onLeaveUser: () => void;
  /** Right-click on an occupant. Absent leaves the channel's own menu to answer. */
  onContextMenuUser?: (user: UserEntry, event: React.MouseEvent) => void;
}

/**
 * The channel tree.
 *
 * Every occupied channel says who is in it - deciding where to go means seeing
 * who is already there, so a bare headcount is not enough - either by name or
 * as a row of faces, which is the choice the Personalize page's channel-viewer
 * control makes. The channel you are talking in is the one that gets card
 * chrome; the rest are plain rows.
 *
 * One click reads a channel, a double click (or the headcount badge) joins its
 * voice.
 */
export function ChannelList({
  channels,
  users,
  selectedChannel,
  currentChannel,
  talkingSessions,
  unreadCounts,
  ownSession,
  privateRooms = [],
  onSelect,
  onJoin,
  onContextMenu,
  onSelectUser,
  onHoverUser,
  onLeaveUser,
  onContextMenuUser,
}: Readonly<ChannelListProps>) {
  const { t } = useTranslation("nebulaSidebar");
  const occupantsByChannel = useMemo(() => groupOccupants(users), [users]);
  const viewer = useChannelViewer();

  const row = (entry: OrderedChannel) => (
    <ChannelRow
      key={entry.channel.id}
      channel={entry.channel}
      depth={entry.depth}
      viewer={viewer}
      joined={entry.channel.id === currentChannel}
      selected={entry.channel.id === selectedChannel}
      occupants={occupantsByChannel.get(entry.channel.id) ?? []}
      unread={unreadCounts[entry.channel.id] ?? 0}
      ownSession={ownSession}
      talkingSessions={talkingSessions}
      onSelect={onSelect}
      onJoin={onJoin}
      onContextMenu={onContextMenu}
      onSelectUser={onSelectUser}
      onHoverUser={onHoverUser}
      onLeaveUser={onLeaveUser}
      onContextMenuUser={onContextMenuUser}
    />
  );

  return (
    <Box
      component="ul"
      sx={{
        flex: 1,
        overflowY: "auto",
        overflowX: "hidden",
        listStyle: "none",
        m: 0,
        p: "8px 10px",
        display: "flex",
        flexDirection: "column",
        gap: "2px",
        minHeight: 0,
      }}
    >
      {/* Labelled only when there is a second group to tell it apart from. One
          list needs no heading saying what it is. */}
      {privateRooms.length > 0 && (
        <>
          <GroupLabel>{t("channels.privateRooms")}</GroupLabel>
          {privateRooms.map((channel) => row({ channel, depth: 0 }))}
          <GroupLabel>{t("channels.title")}</GroupLabel>
        </>
      )}
      {channels.map((entry) => row(entry))}
    </Box>
  );
}

/** Which of the two lists the rows under it belong to. */
function GroupLabel({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <Box component="li">
      <SectionLabel sx={{ px: "8px", pt: "10px", pb: "4px", "&:first-of-type": { pt: 0 } }}>
        {children}
      </SectionLabel>
    </Box>
  );
}

/**
 * The selected channel row, in whichever way this theme marks one.
 *
 * The sheet gives four treatments across the twelve skins - a translucent wash
 * of the accent (most), a solid accent fill with its own ink (Mobel, Ply,
 * Midnight), a glow behind that fill (Midnight), and an inset bar down the
 * leading edge (Guardbase) - plus the notch Midnight cuts out of the row. All
 * four ride on `palette.nebulaSkin`, so a row never has to know which theme it
 * is in.
 */
function selectionStyle(theme: Theme, selected: boolean) {
  const { nebula, nebulaSkin } = theme.palette;
  if (!selected) {
    return { color: nebula.muted, background: "transparent", border: "1px solid transparent" } as const;
  }
  const solid = nebulaSkin.selection === "solid";
  return {
    color: solid ? nebula.onAccent : nebula.text,
    background: solid ? nebula.accent : nebula.accentSoft,
    border: `1px solid ${solid ? "transparent" : nebula.accentLine}`,
    clipPath: nebulaSkin.clipSelection === "none" ? undefined : nebulaSkin.clipSelection,
    boxShadow: nebulaSkin.selectionGlow
      ? `0 0 14px ${nebula.accentLine}`
      : nebulaSkin.selectionBar
        ? `inset 3px 0 0 ${nebula.accent}`
        : undefined,
  } as const;
}

interface ChannelRowProps {
  channel: ChannelEntry;
  depth: number;
  viewer: NebulaChannelViewer;
  joined: boolean;
  selected: boolean;
  occupants: readonly UserEntry[];
  unread: number;
  ownSession: number | null;
  talkingSessions: ReadonlySet<number>;
  onSelect: (channel: ChannelEntry) => void;
  onJoin: (channel: ChannelEntry) => void;
  onContextMenu: (channel: ChannelEntry, event: React.MouseEvent) => void;
  onSelectUser: (session: number, event: React.MouseEvent) => void;
  onHoverUser: (session: number, event: React.MouseEvent) => void;
  onLeaveUser: () => void;
  onContextMenuUser?: (user: UserEntry, event: React.MouseEvent) => void;
}

function ChannelRow({
  channel,
  depth,
  viewer,
  joined,
  selected,
  occupants,
  unread,
  ownSession,
  talkingSessions,
  onSelect,
  onJoin,
  onContextMenu,
  onSelectUser,
  onHoverUser,
  onLeaveUser,
  onContextMenuUser,
}: Readonly<ChannelRowProps>) {
  const { t } = useTranslation("nebulaSidebar");
  // The faces belong on the row itself, so a channel whose people are drawn
  // there has nothing left to nest underneath it.
  const stacked = viewer === "modern" && occupants.length > 0;

  return (
    <Box
      component="li"
      sx={(theme) => ({
        ml: `${depth * 12}px`,
        ...(joined
          ? {
              borderRadius: radius("md"),
              background: theme.palette.nebula.card,
              border: `1px solid ${theme.palette.nebula.line}`,
            }
          : {}),
      })}
    >
      <Stack
        direction="row"
        alignItems="center"
        gap={1.125}
        onClick={() => onSelect(channel)}
        onDoubleClick={joined ? undefined : () => onJoin(channel)}
        onContextMenu={(event) => onContextMenu(channel, event)}
        sx={(theme) =>
          joined
            ? { px: "10px", py: "8px", cursor: "pointer" }
            : {
                px: "12px",
                py: "10px",
                borderRadius: radius("md"),
                cursor: "pointer",
                // How a theme marks the selected row is one of the four levers
                // the design sheet pushes: a wash of the accent, a solid fill,
                // a glow, or a bar down the leading edge. The skin says which.
                ...selectionStyle(theme, selected),
                "&:hover": selected ? {} : { background: theme.palette.nebula.hover },
              }
        }
      >
        <ChannelGlyph channel={channel} active={joined || selected} />
        <Typography sx={{ fontSize: 12.5, fontWeight: joined ? 600 : 400 }} noWrap>
          {channel.name}
        </Typography>
        {stacked && <StackedOccupants occupants={occupants} talkingSessions={talkingSessions} />}
        {joined ? (
          <Stack
            direction="row"
            alignItems="center"
            gap={0.625}
            sx={(theme) => ({ ml: "auto", fontSize: 10.5, color: theme.palette.nebula.ok })}
          >
            <VolumeIcon width={10} height={10} />
            {occupants.length}
          </Stack>
        ) : (
          <Stack direction="row" alignItems="center" gap={0.75} sx={{ ml: "auto" }}>
            {unread > 0 && <StatusDot status="online" size={5} />}
            {channel.user_count > 0 && (
              <Tooltip title={t("channels.inVoice", { count: channel.user_count })}>
                <Box
                  component="span"
                  onClick={(event) => {
                    event.stopPropagation();
                    onJoin(channel);
                  }}
                  sx={(theme) => ({
                    fontSize: 10.5,
                    color: theme.palette.nebula.dim,
                    cursor: "pointer",
                    "&:hover": { color: theme.palette.nebula.accent },
                  })}
                >
                  {channel.user_count}
                </Box>
              </Tooltip>
            )}
          </Stack>
        )}
      </Stack>

      {!stacked && occupants.length > 0 && (
        <Stack sx={{ px: joined ? "8px" : "11px", pb: "8px", gap: "1px" }}>
          {occupants.map((user) => (
            <OccupantRow
              key={user.session}
              user={user}
              own={user.session === ownSession}
              talking={talkingSessions.has(user.session)}
              onSelect={onSelectUser}
              onHover={onHoverUser}
              onLeave={onLeaveUser}
              onContextMenu={onContextMenuUser}
            />
          ))}
        </Stack>
      )}
    </Box>
  );
}

/**
 * A channel's occupants as a row of overlapping faces.
 *
 * Enough of them to recognise the room at a glance, then a count - a channel
 * with thirty people in it is "thirty people", and thirty 18px circles say
 * that worse than the number does.
 */
function StackedOccupants({
  occupants,
  talkingSessions,
}: Readonly<{ occupants: readonly UserEntry[]; talkingSessions: ReadonlySet<number> }>) {
  const shown = occupants.slice(0, MAX_STACKED);
  const overflow = occupants.length - shown.length;

  return (
    <Stack direction="row" alignItems="center" sx={{ ml: "4px", flex: "none" }}>
      {shown.map((user, index) => (
        <Tooltip key={user.session} title={user.name}>
          <Box sx={{ display: "flex", ml: index === 0 ? 0 : "-6px" }}>
            <UserAvatar
              name={user.name}
              session={user.session}
              textureSize={user.texture_size}
              size={18}
              talking={talkingSessions.has(user.session)}
            />
          </Box>
        </Tooltip>
      ))}
      {overflow > 0 && (
        <Typography
          sx={(theme) => ({
            ml: "4px",
            fontSize: 9.5,
            fontWeight: 600,
            color: theme.palette.nebula.dim,
          })}
        >
          +{overflow}
        </Typography>
      )}
    </Stack>
  );
}

interface OccupantRowProps {
  user: UserEntry;
  own: boolean;
  talking: boolean;
  onSelect: (session: number, event: React.MouseEvent) => void;
  onHover: (session: number, event: React.MouseEvent) => void;
  onLeave: () => void;
  onContextMenu?: (user: UserEntry, event: React.MouseEvent) => void;
}

function OccupantRow({
  user,
  own,
  talking,
  onSelect,
  onHover,
  onLeave,
  onContextMenu,
}: Readonly<OccupantRowProps>) {
  return (
    <Stack
      direction="row"
      alignItems="center"
      gap={1.125}
      onClick={(event) => onSelect(user.session, event)}
      onMouseEnter={(event) => onHover(user.session, event)}
      onMouseLeave={onLeave}
      onContextMenu={onContextMenu ? (event) => onContextMenu(user, event) : undefined}
      sx={(theme) => ({
        px: "8px",
        py: "5px",
        borderRadius: radius("md"),
        cursor: "pointer",
        color: own ? theme.palette.nebula.muted : "inherit",
        "&:hover": { background: theme.palette.nebula.hover },
      })}
    >
      <UserAvatar
        name={user.name}
        session={user.session}
        textureSize={user.texture_size}
        size={20}
        talking={talking}
      />
      <Typography sx={{ fontSize: 12.5 }} noWrap>
        {user.name}
      </Typography>
      <PriorityBadge user={user} />
      <VoiceStateBadges user={user} />
      {own ? (
        <Typography
          sx={(theme) => ({
            ml: "auto",
            fontSize: 9.5,
            fontWeight: 500,
            color: theme.palette.nebula.dim,
          })}
        >
          you
        </Typography>
      ) : (
        <Box sx={{ ml: "auto", display: "flex" }}>
          <TalkingBars talking={talking} />
        </Box>
      )}
    </Stack>
  );
}

function ChannelGlyph({ channel, active }: Readonly<{ channel: ChannelEntry; active: boolean }>) {
  const { t } = useTranslation("nebulaSidebar");
  // Only a channel that has a description costs a fetch here, and the blob is
  // cached: a tree of rooms that never set an icon asks the server nothing.
  const description = useChannelDescription(channel.id, channel.description_size);
  const icon = useMemo(
    () => (description ? parseChannelDescription(description).profile?.icon : undefined),
    [description],
  );

  if (icon)
    return (
      <Box
        component="img"
        src={icon}
        alt=""
        sx={{ width: 14, height: 14, borderRadius: radius("sm"), objectFit: "cover", flex: "none" }}
      />
    );
  if (channel.is_enter_restricted)
    return (
      <Box
        component="span"
        aria-label={t("channels.restricted")}
        sx={(theme) => ({ display: "flex", color: theme.palette.nebula.warn })}
      >
        <LockIcon width={12} height={12} />
      </Box>
    );
  return (
    <Box
      component="span"
      aria-hidden
      sx={(theme) => ({
        fontSize: 13,
        lineHeight: 1,
        color: active ? theme.palette.nebula.accent : theme.palette.nebula.dim,
      })}
    >
      #
    </Box>
  );
}
