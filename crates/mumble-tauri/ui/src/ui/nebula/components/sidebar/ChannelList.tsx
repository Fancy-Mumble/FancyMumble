import { useMemo } from "react";
import { Box, Tooltip, Typography } from "@mui/material";
import type { ChannelEntry, UserEntry } from "@core/types";
import { LockIcon, VolumeIcon } from "@ui/icons";
import { groupOccupants, type OrderedChannel } from "../../selectors";
import { PriorityBadge, StatusDot, TalkingBars, UserAvatar, VoiceStateBadges, Stack } from "../primitives";
import { radius } from "../../tokens";

interface ChannelListProps {
  channels: readonly OrderedChannel[];
  users: readonly UserEntry[];
  selectedChannel: number | null;
  currentChannel: number | null;
  talkingSessions: ReadonlySet<number>;
  unreadCounts: Record<number, number>;
  ownSession: number | null;
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
 * Every occupied channel lists who is in it - deciding where to go means
 * seeing who is already there, so a bare headcount is not enough. The channel
 * you are talking in is the one that gets card chrome; the rest are plain rows
 * with their members nested underneath.
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
  onSelect,
  onJoin,
  onContextMenu,
  onSelectUser,
  onHoverUser,
  onLeaveUser,
  onContextMenuUser,
}: Readonly<ChannelListProps>) {
  const occupantsByChannel = useMemo(() => groupOccupants(users, talkingSessions), [users, talkingSessions]);

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
      {channels.map(({ channel, depth }) => {
        const joined = channel.id === currentChannel;
        const selected = channel.id === selectedChannel;
        const occupants = occupantsByChannel.get(channel.id) ?? [];
        const unread = unreadCounts[channel.id] ?? 0;

        return (
          <Box
            component="li"
            key={channel.id}
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
                      color: selected ? theme.palette.nebula.text : theme.palette.nebula.muted,
                      background: selected ? theme.palette.nebula.card : "transparent",
                      border: `1px solid ${selected ? theme.palette.nebula.line : "transparent"}`,
                      "&:hover": { background: theme.palette.nebula.hover },
                    }
              }
            >
              <ChannelGlyph channel={channel} active={joined || selected} />
              <Typography sx={{ fontSize: 12.5, fontWeight: joined ? 600 : 400 }} noWrap>
                {channel.name}
              </Typography>
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
                    <Tooltip title={`${channel.user_count} in voice`}>
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

            {occupants.length > 0 && (
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
      })}
    </Box>
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
  if (channel.is_enter_restricted)
    return (
      <Box
        component="span"
        aria-label="Restricted channel"
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
