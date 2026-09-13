import { useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Box, Button, Tooltip, Typography } from "@mui/material";
import { useTheme, type Theme } from "@mui/material/styles";
import { chamferedSurface } from "../../theme";
import { parseChannelDescription } from "@core/channelProfile";
import { useChannelDescription } from "@core/lazyBlobs";
import type { ChannelEntry, UserEntry } from "@core/types";
import { TID } from "@core/testids";
import { GripVerticalIcon, ListenBadgeIcon, LockIcon, VolumeIcon } from "@ui/icons";
import { isMobile } from "@core/utils/platform";
import { PERM_MOVE } from "@core/utils/permissions";
import { useCarryRoom, useCarryUser, useChannelDropTarget, type CarriedGhost } from "@ui/userCarry";
import { byName, groupOccupants, type OrderedChannel } from "../../selectors";
import { arrangeState, siblingBlocks, type ArrangeState } from "../../channelArrange";
import { useChannelArrange, type ArrangeDrag } from "./useChannelArrange";
import { useChannelViewer, type NebulaChannelViewer } from "../../useChannelViewer";
import {
  DmUnreadBadge,
  MakeRoom,
  PchatBadge,
  RoleColorsContext,
  useRoleColor,
  PriorityBadge,
  SectionLabel,
  StatusDot,
  TalkingBars,
  UserAvatar,
  LiveBadge, VoiceContextBadge,
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
  /** Channels being listened to without being in them, each marked on its row. */
  listenedChannels?: ReadonlySet<number>;
  /** `user_id` to the colour their name is drawn in, from the server's roles. */
  roleColors?: ReadonlyMap<number, string>;
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
  /**
   * Arrange mode: a drag on a row moves the channel among its siblings instead
   * of carrying anyone, and the rows stop opening channels. Occupants and
   * private rooms step out of the way, since neither can be arranged.
   */
  arranging?: boolean;
  /** Put a channel in front of a sibling, or last among them for null. */
  onArrange?: (channelId: number, beforeId: number | null) => void;
  onDoneArranging?: () => void;
}

const nothing = () => {};
const NO_CHANNELS: ReadonlySet<number> = new Set();
const NO_COLORS: ReadonlyMap<number, string> = new Map();

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
  listenedChannels = NO_CHANNELS,
  roleColors = NO_COLORS,
  privateRooms = [],
  onSelect,
  onJoin,
  onContextMenu,
  onSelectUser,
  onHoverUser,
  onLeaveUser,
  onContextMenuUser,
  arranging = false,
  onArrange = nothing,
  onDoneArranging = nothing,
}: Readonly<ChannelListProps>) {
  const { t } = useTranslation("nebulaSidebar");
  const arrange = useChannelArrange({
    entries: channels,
    enabled: arranging,
    onMove: onArrange,
    onDone: onDoneArranging,
  });
  const draggedId = arrange.drag?.channelId ?? null;
  // The carried channel and everything under it, which go faint together:
  // they are what moves.
  const lifted = useMemo(() => {
    if (draggedId === null) return null;
    const block = siblingBlocks(channels, draggedId).find((candidate) => candidate.channelId === draggedId);
    return new Set(block ? channels.slice(block.first, block.last + 1).map((entry) => entry.channel.id) : []);
  }, [channels, draggedId]);
  const occupantsByChannel = useMemo(() => groupOccupants(users), [users]);
  // Ranked the way the lists themselves are, which is what says where somebody
  // carried into a channel will sit once they are in it.
  const roster = useMemo(() => [...users].sort(byName), [users]);
  const viewer = useChannelViewer();

  const row = (entry: OrderedChannel) => (
    <ChannelRow
      key={entry.channel.id}
      arranging={arranging}
      arrangeable={arranging ? arrangeState(channels, entry.channel) : null}
      lifted={lifted?.has(entry.channel.id) ?? false}
      registerArrangeRow={arrange.registerRow}
      beginArrange={arrange.beginGesture}
      channel={entry.channel}
      depth={entry.depth}
      viewer={viewer}
      joined={entry.channel.id === currentChannel}
      selected={entry.channel.id === selectedChannel}
      occupants={occupantsByChannel.get(entry.channel.id) ?? []}
      roster={roster}
      unread={unreadCounts[entry.channel.id] ?? 0}
      listening={listenedChannels.has(entry.channel.id)}
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
    <RoleColorsContext.Provider value={roleColors}>
    <Box
      component="ul"
      ref={arrange.listRef}
      sx={{
        userSelect: arranging ? "none" : undefined,
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
      {arranging && <ArrangeBar onDone={onDoneArranging} />}
      {!arranging && privateRooms.length > 0 && (
        <>
          <GroupLabel>{t("channels.privateRooms")}</GroupLabel>
          {privateRooms.map((channel) => row({ channel, depth: 0 }))}
          <GroupLabel>{t("channels.title")}</GroupLabel>
        </>
      )}
      {channels.map((entry) => row(entry))}
      {arrange.drag && (
        <ArrangeOverlay
          drag={arrange.drag}
          ghostRef={arrange.ghostRef}
          channel={channels.find((entry) => entry.channel.id === draggedId)?.channel}
        />
      )}
    </Box>
    </RoleColorsContext.Provider>
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
 * The sheet gives four treatments across the skins - a translucent wash of the
 * accent (most), a solid accent fill with its own ink (Mobel, Ply, Midnight,
 * Nimbus), a glow behind that fill (Midnight, Nimbus), and an inset bar down
 * the leading edge (Guardbase, Nimbus) - plus the notch Midnight and Nimbus
 * cut out of the row. All four ride on `palette.nebulaSkin`, so a row never
 * has to know which theme it is in, and they compose: Nimbus wears three at
 * once.
 */
function selectionStyle(theme: Theme, selected: boolean) {
  const { nebula, nebulaSkin } = theme.palette;
  if (!selected) {
    // A drawn skin stands every row on a plate, selected or not: the mock's
    // unselected channels are white cards, and only the fill and the leading
    // bar say which one is open. Every other skin leaves the row bare.
    if (nebulaSkin.chrome === "stencil") {
      return {
        color: nebula.text,
        ...chamferedSurface(
          theme,
          nebula.card,
          nebula.line,
          nebulaSkin.clipSelection === "none" ? "none" : nebulaSkin.clipSelection,
        ),
      } as const;
    }
    return { color: nebula.muted, background: "transparent", border: "var(--nebula-line-width, 1px) solid transparent" } as const;
  }
  const solid = nebulaSkin.selection === "solid";
  const clip = nebulaSkin.clipSelection === "none" ? undefined : nebulaSkin.clipSelection;
  return {
    color: solid ? nebula.onAccent : nebula.text,
    background: solid ? nebula.accent : nebula.accentSoft,
    border: `var(--nebula-line-width, 1px) solid ${solid ? "transparent" : nebula.accentLine}`,
    clipPath: clip,
    // The bar below is a plate of its own, and it is placed against this box.
    position: "relative",
    // Keeps that plate under the row's label rather than over it: a negative
    // z-index paints after the background and before the content, but only
    // inside a stacking context this row owns.
    isolation: "isolate",
    // The two marks compose rather than exclude: Midnight glows, Guardbase
    // bars, and Nimbus does both. On a solid fill the bar switches to the
    // theme's second hue, because an accent bar on an accent row is invisible
    // - which is also what Nimbus wants, a gold edge against the blue plate.
    boxShadow: nebulaSkin.selectionGlow ? `0 0 14px ${nebula.accentLine}` : undefined,
    // Drawn rather than shadowed. An inset shadow is upright, and a row that
    // leans clips it into a wedge; a plate wearing the row's own silhouette
    // leans with it, because the lean the polygon spends is stated in pixels
    // and so survives being applied to a box of any width.
    ...(nebulaSkin.selectionBar
      ? {
          "&::before": {
            content: '""',
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            zIndex: -1,
            width: `${nebulaSkin.selectionBarPx}px`,
            background: solid ? nebula.accent2 : nebula.accent,
            clipPath: clip,
          },
        }
      : {}),
  } as const;
}

interface ChannelRowProps {
  arranging: boolean;
  /** Whether this row can be picked up in arrange mode, and why not; null outside it. */
  arrangeable: ArrangeState | null;
  /** Part of the channel being dragged, which fades while it is in the air. */
  lifted: boolean;
  registerArrangeRow: (channelId: number, element: HTMLElement | null) => void;
  beginArrange: (
    channelId: number,
  ) => (event: React.PointerEvent<HTMLElement> | React.MouseEvent<HTMLElement>) => void;
  channel: ChannelEntry;
  depth: number;
  viewer: NebulaChannelViewer;
  joined: boolean;
  selected: boolean;
  occupants: readonly UserEntry[];
  /** Everyone on the server, in the order a channel would list them. */
  roster: readonly UserEntry[];
  unread: number;
  /** Listened to from outside it, which the row marks. */
  listening: boolean;
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
  arranging,
  arrangeable: arrangeState,
  lifted,
  registerArrangeRow,
  beginArrange,
  channel,
  depth,
  viewer,
  joined,
  selected,
  occupants,
  roster,
  unread,
  listening,
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
  // Whether this row is painted as a solid block of the accent, which is what
  // decides if the glyph may be drawn in the accent too - on Mobel, Ply,
  // Midnight and Nimbus that would be accent on accent, and invisible.
  const skin = useTheme().palette.nebulaSkin;
  const filled = selected && skin.selection === "solid";
  // A drawn skin stands every row on a plate of the same width, the one you
  // are in included. Framing that row in a second card as well is what left
  // the open channel looking indented against the list it belongs to - the
  // plate started a border and a padding in from every other one.
  const plated = skin.chrome === "stencil";
  // The faces belong on the row itself, so a channel whose people are drawn
  // there has nothing left to nest underneath it.
  const stacked = !arranging && viewer === "modern" && occupants.length > 0;
  // Somewhere a carried user can be dropped, and the seat that opens in the
  // list below when the pointer is over it.
  const drop = useChannelDropTarget(channel.id);
  const { room, carrying, registerRow } = useCarryRoom(channel.id, occupants, roster);
  // Carrying somebody else out of this channel is a moderator's move; your own
  // row is yours to carry wherever you are allowed to go.
  const canMove = ((channel.permissions ?? 0) & PERM_MOVE) !== 0;
  const arrangeable = arrangeState === "movable";
  // One element answers both for where a carried user lands and for where a
  // dragged channel's block starts and ends.
  const dropRef = drop.ref;
  const rowRef = useCallback(
    (element: HTMLElement | null) => {
      dropRef(element);
      registerArrangeRow(channel.id, element);
    },
    [dropRef, registerArrangeRow, channel.id],
  );

  return (
    <Box
      component="li"
      ref={rowRef}
      // The whole element is the handle while arranging, card and padding
      // included, not just the line with the name on it.
      onPointerDown={arrangeable ? beginArrange(channel.id) : undefined}
      onMouseDown={arrangeable ? beginArrange(channel.id) : undefined}
      // A row without a handle says why, rather than looking broken.
      title={
        arrangeState === "alone"
          ? t("channels.arrangeAlone")
          : arrangeState === "denied"
            ? t("channels.arrangeDenied")
            : undefined
      }
      style={arranging ? { cursor: arrangeable ? "grab" : "default", touchAction: arrangeable ? "none" : undefined } : undefined}
      sx={(theme) => ({
        ml: `${depth * 12}px`,
        opacity: lifted ? 0.35 : 1,
        borderRadius: radius("md"),
        // The channel a carried user would land in says so itself, rather than
        // leaving the ghost under the pointer to be read as the answer.
        ...(drop.active
          ? {
              outline: `2px dashed ${theme.palette.nebula.accent}`,
              outlineOffset: 1,
              background: theme.palette.nebula.accentSoft,
            }
          : {}),
        ...(joined && !plated
          ? {
              borderRadius: radius("md"),
              background: theme.palette.nebula.card,
              border: `var(--nebula-line-width, 1px) solid ${theme.palette.nebula.line}`,
            }
          : {}),
      })}
    >
      <Stack
        direction="row"
        alignItems="center"
        gap={1.125}
        data-testid={TID.channelItem}
        data-channel-id={channel.id}
        data-channel-name={channel.name}
        data-joined={joined ? "true" : undefined}
        data-arrangeable={arrangeable ? "true" : undefined}
        onClick={arranging ? undefined : () => onSelect(channel)}
        onDoubleClick={joined || arranging ? undefined : () => onJoin(channel)}
        onContextMenu={(event) => onContextMenu(channel, event)}
        // Inline, so it wins over the pointer cursor either row shape sets.
        style={arranging ? { cursor: arrangeable ? "grab" : "default" } : undefined}
        sx={(theme) =>
          joined && !plated
            ? {
                px: "10px",
                py: "8px",
                cursor: "pointer",
                // The card says "you are here"; on its own it never says "you
                // are reading this", so the selection mark used to disappear
                // the moment the channel you were reading was also the one you
                // were in - which is the ordinary case. The card's header row
                // takes the theme's own mark instead, squared off at the
                // bottom because the roster continues underneath it.
                ...(selected
                  ? {
                      borderRadius: `${radius("md")} ${radius("md")} 0 0`,
                      ...selectionStyle(theme, true),
                    }
                  : {}),
              }
            : {
                px: "12px",
                py: "10px",
                borderRadius: radius("md"),
                cursor: "pointer",
                // A plated row is a card, and the artboard's cards are taller
                // than the pack's bare rows: 44px against roughly 35.
                ...(theme.palette.nebulaSkin.chrome === "stencil"
                  ? { px: "16px", minHeight: 49, boxSizing: "border-box" }
                  : {}),
                // How a theme marks the selected row is one of the four levers
                // the design sheet pushes: a wash of the accent, a solid fill,
                // a glow, or a bar down the leading edge. The skin says which.
                ...selectionStyle(theme, selected),
                "&:hover": selected ? {} : { background: theme.palette.nebula.hover },
              }
        }
      >
        {arranging && <ArrangeGrip shown={arrangeable} />}
        <ChannelGlyph channel={channel} active={joined || selected} filled={filled} />
        <Typography sx={{ fontSize: 12.5, fontWeight: joined ? 600 : 400 }} noWrap>
          {channel.name}
        </Typography>
        {/* Whether a room keeps its history is a property of the room, so it
            belongs on the row rather than only on the channel once opened:
            picking which room to speak in is exactly when it matters. */}
        <PchatBadge protocol={channel.pchat_protocol} />
        {listening && <ListenMark />}
        {stacked && <StackedOccupants occupants={occupants} talkingSessions={talkingSessions} />}
        {/* Faces carry no badges, so a room drawn as a stack says it has
            someone sharing on the row itself, as Standard's icon list does. */}
        {stacked && <LiveBadge sessions={occupants.map((occupant) => occupant.session)} />}
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
            {!arranging && channel.user_count > 0 && (
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

      {!arranging && !stacked && occupants.length > 0 && (
        <Stack
          sx={{
            px: joined ? "8px" : "11px",
            pb: "8px",
            gap: "1px",
            // The rows that stepped down would otherwise hang out of the
            // bottom of the channel; this is all the seat actually lays out.
            mb: room ? `${room.step}px` : 0,
            transition: carrying ? "margin-bottom 170ms cubic-bezier(.2,0,0,1)" : "none",
            "@media (prefers-reduced-motion: reduce)": { transition: "none" },
          }}
        >
          {occupants.map((user) => (
            <MakeRoom
              key={user.session}
              offset={room?.offsets.get(user.session)}
              animate={carrying}
            >
              <OccupantRow
                user={user}
                own={user.session === ownSession}
                talking={talkingSessions.has(user.session)}
                canMove={canMove}
                registerRow={registerRow}
                onSelect={onSelectUser}
                onHover={onHoverUser}
                onLeave={onLeaveUser}
                onContextMenu={onContextMenuUser}
              />
            </MakeRoom>
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
  /** Whether this channel's people may be moved out of it by hand. */
  canMove: boolean;
  registerRow: (session: number, element: HTMLElement | null) => void;
  onSelect: (session: number, event: React.MouseEvent) => void;
  onHover: (session: number, event: React.MouseEvent) => void;
  onLeave: () => void;
  onContextMenu?: (user: UserEntry, event: React.MouseEvent) => void;
}

function OccupantRow({
  user,
  own,
  talking,
  canMove,
  registerRow,
  onSelect,
  onHover,
  onLeave,
  onContextMenu,
}: Readonly<OccupantRowProps>) {
  const { t } = useTranslation("nebulaSidebar");
  // Your own row goes wherever you may go; anyone else's needs the permission
  // to move them. Touch has no cursor to carry anything with.
  const carry = useCarryUser(user.session, isMobile || (!own && !canMove));
  const nameColor = useRoleColor(user.user_id);

  return (
    <Stack
      direction="row"
      alignItems="center"
      gap={1.125}
      data-testid={TID.channelMember}
      data-user-name={user.name}
      ref={(element: HTMLElement | null) => registerRow(user.session, element)}
      onClick={(event) => onSelect(user.session, event)}
      onMouseEnter={(event) => onHover(user.session, event)}
      onMouseLeave={onLeave}
      onContextMenu={onContextMenu ? (event) => onContextMenu(user, event) : undefined}
      {...carry.handlers}
      sx={(theme) => ({
        px: "8px",
        py: "5px",
        borderRadius: radius("md"),
        cursor: "pointer",
        color: own ? theme.palette.nebula.muted : "inherit",
        // The row owns the gesture, so the browser must not start a selection
        // or a scroll from the same press - nor drag the avatar inside it.
        userSelect: "none",
        touchAction: "none",
        "& img": { WebkitUserDrag: "none" },
        "&:hover": { background: theme.palette.nebula.hover },
      })}
    >
      {carry.ghost && <CarriedUser ghost={carry.ghost} elRef={carry.ghostRef} user={user} />}
      <UserAvatar
        name={user.name}
        session={user.session}
        textureSize={user.texture_size}
        size={20}
        talking={talking}
      />
      <Typography sx={{ fontSize: 12.5, color: nameColor ?? "inherit" }} noWrap>
        {user.name}
      </Typography>
      <PriorityBadge user={user} />
      <VoiceStateBadges user={user} />
      <LiveBadge session={user.session} />
      <VoiceContextBadge session={user.session} />
      {!own && <DmUnreadBadge session={user.session} />}
      {own ? (
        <Typography
          sx={(theme) => ({
            ml: "auto",
            fontSize: 9.5,
            fontWeight: 500,
            color: theme.palette.nebula.dim,
          })}
        >
          {t("channels.you")}
        </Typography>
      ) : (
        <Box sx={{ ml: "auto", display: "flex" }}>
          <TalkingBars talking={talking} />
        </Box>
      )}
    </Stack>
  );
}

function ChannelGlyph({
  channel,
  active,
  filled,
}: Readonly<{ channel: ChannelEntry; active: boolean; filled: boolean }>) {
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
        // On a filled row the ink is the row's own, stepped back so the glyph
        // still reads as secondary to the name beside it.
        color: filled
          ? "currentColor"
          : active
            ? theme.palette.nebula.accent
            : theme.palette.nebula.dim,
        opacity: filled ? 0.65 : 1,
      })}
    >
      #
    </Box>
  );
}

/**
 * Whoever is being carried, under the pointer.
 *
 * At the document root rather than in the list: the sidebar clips what
 * overflows it, and the whole point of the ghost is that it leaves.
 */
function CarriedUser({
  ghost,
  elRef,
  user,
}: Readonly<{
  ghost: CarriedGhost;
  elRef: React.MutableRefObject<HTMLElement | null>;
  user: UserEntry;
}>) {
  return createPortal(
    <Box
      aria-hidden
      ref={elRef as React.MutableRefObject<HTMLDivElement | null>}
      sx={(theme) => ({
        position: "fixed",
        left: 0,
        top: 0,
        width: ghost.width,
        height: ghost.height,
        transform: `translate(${ghost.left}px, ${ghost.top}px)`,
        display: "flex",
        alignItems: "center",
        gap: "9px",
        px: "8px",
        boxSizing: "border-box",
        pointerEvents: "none",
        zIndex: 1400,
        borderRadius: radius("md"),
        // A ground of its own: the row it is drawn from is translucent, and
        // carried over the tree it would otherwise read through.
        background: theme.palette.nebula.bg0,
        border: `var(--nebula-line-width, 1px) solid ${theme.palette.nebula.accentLine}`,
        boxShadow: "0 10px 24px rgba(2,6,18,.5)",
      })}
    >
      <UserAvatar name={user.name} session={user.session} textureSize={user.texture_size} size={20} />
      <Typography sx={{ fontSize: 12.5 }} noWrap>
        {user.name}
      </Typography>
    </Box>,
    document.body,
  );
}


/**
 * Pinned over the list while it is being arranged: says what a drag does now,
 * since the same gesture carries users the rest of the time, and is the
 * obvious way back out.
 */
function ArrangeBar({ onDone }: Readonly<{ onDone: () => void }>) {
  const { t } = useTranslation("nebulaSidebar");
  return (
    <Box
      component="li"
      data-testid={TID.channelArrangeBar}
      sx={(theme) => ({
        // The list's own padding is 8px; pinned at -8px it sits flush with the
        // top edge instead of letting rows scroll through the gap above it.
        position: "sticky",
        top: "-8px",
        zIndex: 1,
        display: "flex",
        alignItems: "center",
        gap: "8px",
        mb: "4px",
        pl: "10px",
        pr: "4px",
        py: "4px",
        borderRadius: radius("md"),
        background: theme.palette.nebula.bg0,
        border: `var(--nebula-line-width, 1px) solid ${theme.palette.nebula.accentLine}`,
        color: theme.palette.nebula.muted,
      })}
    >
      <GripVerticalIcon width={12} height={12} aria-hidden />
      <Typography sx={{ flex: 1, minWidth: 0, fontSize: 11.5 }}>{t("channels.arrangeHint")}</Typography>
      <Button size="small" onClick={onDone} data-testid={TID.channelArrangeDone} sx={{ minWidth: 0, flex: "none" }}>
        {t("channels.arrangeDone")}
      </Button>
    </Box>
  );
}

/** The handle a row is picked up by; a row that cannot move keeps the space. */
function ArrangeGrip({ shown }: Readonly<{ shown: boolean }>) {
  return (
    <Box
      component="span"
      aria-hidden
      sx={(theme) => ({
        display: "flex",
        flex: "none",
        width: 12,
        color: theme.palette.nebula.dim,
        visibility: shown ? "visible" : "hidden",
      })}
    >
      <GripVerticalIcon width={12} height={12} />
    </Box>
  );
}

/**
 * The channel in the air and where it would land.
 *
 * At the document root for the same reason as a carried user: the list clips
 * what overflows it. The ghost is moved by the gesture directly rather than by
 * a render per pointer frame.
 */
function ArrangeOverlay({
  drag,
  ghostRef,
  channel,
}: Readonly<{
  drag: ArrangeDrag;
  ghostRef: React.MutableRefObject<HTMLElement | null>;
  channel: ChannelEntry | undefined;
}>) {
  return createPortal(
    <>
      <Box
        aria-hidden
        ref={ghostRef as React.MutableRefObject<HTMLDivElement | null>}
        sx={(theme) => ({
          position: "fixed",
          left: drag.ghost.left,
          top: drag.ghost.top,
          width: drag.ghost.width,
          height: drag.ghost.height,
          display: "flex",
          alignItems: "center",
          gap: "9px",
          px: "12px",
          boxSizing: "border-box",
          pointerEvents: "none",
          zIndex: 1400,
          borderRadius: radius("md"),
          background: theme.palette.nebula.bg0,
          border: `var(--nebula-line-width, 1px) solid ${theme.palette.nebula.accentLine}`,
          boxShadow: "0 10px 24px rgba(2,6,18,.5)",
          color: theme.palette.nebula.text,
        })}
      >
        <GripVerticalIcon width={12} height={12} />
        <Typography sx={{ fontSize: 12.5 }} noWrap>
          {channel?.name}
        </Typography>
      </Box>
      {drag.line && (
        <Box
          aria-hidden
          data-testid={TID.channelArrangeMark}
          sx={(theme) => ({
            position: "fixed",
            left: drag.line!.left,
            top: drag.line!.top - 1,
            width: drag.line!.width,
            height: 2,
            borderRadius: "1px",
            pointerEvents: "none",
            zIndex: 1400,
            background: theme.palette.nebula.accent,
            boxShadow: `0 0 6px ${theme.palette.nebula.accentLine}`,
          })}
        />
      )}
    </>,
    document.body,
  );
}

/**
 * Listening to a channel from outside it.
 *
 * The listen toggle lives in the channel's menu; without a mark on the row
 * there was no telling which rooms were being heard until one spoke.
 */
function ListenMark() {
  const { t } = useTranslation("sidebar");
  return (
    <Tooltip title={t("channelList.listening")}>
      <Box
        component="span"
        role="img"
        aria-label={t("channelList.listening")}
        data-listening=""
        sx={(theme) => ({ display: "flex", flex: "none", color: theme.palette.nebula.accent })}
      >
        <ListenBadgeIcon width={12} height={12} />
      </Box>
    </Tooltip>
  );
}
