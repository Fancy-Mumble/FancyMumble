import type { ChannelEntry, UserEntry } from "../types";

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
