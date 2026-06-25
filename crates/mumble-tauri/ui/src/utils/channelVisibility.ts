import type { ChannelEntry, UserEntry } from "../types";

/**
 * Display name for a channel. Detached/hidden rooms (e.g. server-provisioned
 * meeting rooms) carry a disambiguation suffix (`"Sprint Review [a1b2c3d4]"`) so
 * their names stay unique; this strips that suffix for display only - the full
 * `channel.name` remains the channel's server-side identity. Ordinary channels
 * are returned unchanged (so a normal channel whose name legitimately ends in
 * `[...]` is never altered).
 */
export function channelDisplayName(channel: ChannelEntry): string {
  if (!channel.detached && !channel.hidden) return channel.name;
  const stripped = channel.name.replace(/\s*\[[^\]]+\]\s*$/, "").trim();
  return stripped.length > 0 ? stripped : channel.name;
}

/** Name prefix of a friend-chat / self-notepad detached channel (the
 *  `fancy-friends` plugin's `__dm:<lo>-<hi>` convention). These are surfaced
 *  through the friends list / DM UI, never the channel viewer. */
export const DM_CHANNEL_PREFIX = "__dm:";

/** Whether a channel is a friend-chat (or self-notepad) DM channel. */
export function isDmChannel(channel: ChannelEntry): boolean {
  return !!channel.detached && channel.name.startsWith(DM_CHANNEL_PREFIX);
}

/**
 * The peer's registered user id for a friend-chat DM channel
 * (`__dm:<lo>-<hi>`, or `__dm:<id>` for a self-notepad), as seen from the viewer
 * whose own id is `ownUserId`. Returns null for non-DM channels. Lets the UI
 * label a `__dm:` channel with the friend's name rather than its raw id name.
 */
export function dmPeerUserId(channel: ChannelEntry, ownUserId: number | null): number | null {
  if (!isDmChannel(channel)) return null;
  const ids = channel.name
    .slice(DM_CHANNEL_PREFIX.length)
    .split("-")
    .map((s) => Number.parseInt(s, 10))
    .filter((n) => Number.isFinite(n));
  if (ids.length === 0) return null;
  if (ids.length === 1) return ids[0]; // self-notepad
  return ids.find((id) => id !== ownUserId) ?? ids[0];
}

/**
 * The detached rooms: parentless, Fancy-only channels (e.g. scheduled meeting
 * rooms) that the server never places in the channel tree. They are surfaced in
 * the dedicated flat "Private rooms"/Meetings list above the tree. Friend-chat
 * (`__dm:`) channels are excluded - those belong to the friends/DM UI.
 */
export function meetingRooms(channels: ChannelEntry[]): ChannelEntry[] {
  return channels.filter((c) => c.detached && !isDmChannel(c));
}

/**
 * Drop detached channels from the main channel tree - they are surfaced in the
 * dedicated flat list (and the calendar UI), never the tree. Returns the input
 * unchanged when there are no detached channels.
 */
export function filterMeetingChannels(channels: ChannelEntry[]): ChannelEntry[] {
  if (!channels.some((c) => c.detached)) return channels;
  return channels.filter((c) => !c.detached);
}

/** The id Mumble assigns the root channel. */
const ROOT_CHANNEL_ID = 0;

/**
 * Re-attribute users sitting in a friend-chat / self-notepad room (`__dm:`, a
 * detached, Fancy-only channel that the tree never renders and the meetings
 * viewer excludes) to the **root** channel, for channel-tree display only.
 *
 * Opening a friend chat *joins* you into its detached channel, so without this
 * remap the local user vanishes from the channel list entirely - grouped under a
 * channel that is never drawn - even though the vanilla client (which can't see
 * the detached room) simply roots them. Mirroring that keeps you visible where
 * you're expected.
 *
 * Only `__dm:` rooms are remapped: ordinary detached meeting rooms surface their
 * occupants in the meetings viewer, and presence-hidden users (the sentinel
 * channel) must stay out of the tree, so both are left under their own id. The
 * input array is returned unchanged (same reference) when there are no DM rooms,
 * and only the remapped users are cloned, so the store's entries are never
 * mutated.
 */
export function usersForChannelTree(
  channels: ChannelEntry[],
  users: UserEntry[],
): UserEntry[] {
  const dmChannelIds = new Set<number>();
  for (const c of channels) {
    if (isDmChannel(c)) dmChannelIds.add(c.id);
  }
  if (dmChannelIds.size === 0) return users;
  return users.map((u) =>
    dmChannelIds.has(u.channel_id) ? { ...u, channel_id: ROOT_CHANNEL_ID } : u,
  );
}

/** Channels that should stay visible even when empty (the user's own context). */
export interface AlwaysVisibleChannels {
  readonly currentChannel: number | null;
  readonly selectedChannel: number | null;
  readonly listenedChannels: ReadonlySet<number>;
}

/**
 * Filter the channel list to only channels that have members (plus the
 * current / selected / listened channels), for the "hide empty channels"
 * option in the channel viewer.
 *
 * Empty channels are hidden **including empty parents**.  So a populated
 * subchannel below an empty parent would be orphaned by a naive filter; to
 * keep the rendered tree consistent, each surviving channel is re-parented
 * onto its nearest *visible* ancestor (or the root, `parent_id = null`, when no
 * ancestor survives).  Returned entries are the originals where unchanged, or
 * shallow clones with an adjusted `parent_id`.
 */
export function filterVisibleChannels(
  channels: ChannelEntry[],
  users: UserEntry[],
  { currentChannel, selectedChannel, listenedChannels }: AlwaysVisibleChannels,
): ChannelEntry[] {
  const memberCount = new Map<number, number>();
  for (const u of users) {
    memberCount.set(u.channel_id, (memberCount.get(u.channel_id) ?? 0) + 1);
  }
  const byId = new Map(channels.map((c) => [c.id, c]));

  const isVisible = (ch: ChannelEntry) =>
    (memberCount.get(ch.id) ?? 0) > 0 ||
    ch.id === currentChannel ||
    ch.id === selectedChannel ||
    listenedChannels.has(ch.id);

  const visibleIds = new Set<number>();
  for (const ch of channels) {
    if (isVisible(ch)) visibleIds.add(ch.id);
  }

  // Walk up from a channel to the first ancestor that is itself visible.
  // `seen` guards against malformed (cyclic / self-parent) data.
  const nearestVisibleParent = (ch: ChannelEntry): number | null => {
    const seen = new Set<number>([ch.id]);
    let parentId = ch.parent_id ?? null;
    while (parentId != null && !seen.has(parentId)) {
      if (visibleIds.has(parentId)) return parentId;
      seen.add(parentId);
      parentId = byId.get(parentId)?.parent_id ?? null;
    }
    return null;
  };

  const result: ChannelEntry[] = [];
  for (const ch of channels) {
    if (!visibleIds.has(ch.id)) continue;
    const newParent = nearestVisibleParent(ch);
    result.push(newParent === (ch.parent_id ?? null) ? ch : { ...ch, parent_id: newParent });
  }
  return result;
}
