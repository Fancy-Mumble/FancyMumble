/**
 * The arithmetic behind arranging the channel tree by hand.
 *
 * A channel is only ever moved among its siblings: its place under a parent is
 * its `position`, and taking it to another parent is the editor's job, not a
 * drag's. Everything here is pure so the gesture can stay a thin shell.
 */

import type { ChannelEntry } from "@core/types";
import { PERM_WRITE } from "@core/utils/permissions";
import { reorderKeys } from "@ui/dragOrder";
import type { OrderedChannel } from "./selectors";

/** The gap the tree is renumbered with, which leaves room for later moves. */
const SPACING = 100;
const MAX_POSITION = 2 ** 31 - 1;
const MIN_POSITION = -(2 ** 31);

export interface PositionWrite {
  channelId: number;
  position: number;
}

/** A channel's siblings as the tree draws them: by position, then by name. */
export function siblingsOf(channels: readonly ChannelEntry[], channel: ChannelEntry): ChannelEntry[] {
  return channels
    .filter((candidate) => !candidate.detached && candidate.parent_id === channel.parent_id)
    .sort((left, right) => left.position - right.position || left.name.localeCompare(right.name));
}

/**
 * The `position` writes that put `movedId` in front of `beforeId` (or last).
 *
 * One write when there is a free number between the neighbours it lands
 * between - which is what spacing by a hundred buys - and a renumbering of the
 * whole sibling group only when there is not. Every write is a round trip the
 * server may refuse, so the fewer channels a move touches the better.
 */
export function planChannelMove(
  channels: readonly ChannelEntry[],
  movedId: number,
  beforeId: number | null,
): PositionWrite[] {
  const moved = channels.find((channel) => channel.id === movedId);
  if (!moved) return [];
  const siblings = siblingsOf(channels, moved);
  const byId = new Map(siblings.map((channel) => [String(channel.id), channel]));
  const before = beforeId === null ? null : String(beforeId);
  if (before !== null && !byId.has(before)) return [];

  const keys = siblings.map((channel) => String(channel.id));
  const next = reorderKeys(keys, String(movedId), before);
  if (next.every((key, index) => key === keys[index])) return [];

  const at = next.indexOf(String(movedId));
  const previous = at > 0 ? byId.get(next[at - 1]) : undefined;
  const following = at < next.length - 1 ? byId.get(next[at + 1]) : undefined;

  const between =
    previous && following
      ? following.position - previous.position >= 2
        ? previous.position + Math.floor((following.position - previous.position) / 2)
        : null
      : previous
        ? previous.position + SPACING
        : following
          ? following.position - SPACING
          : null;
  if (between !== null && between <= MAX_POSITION && between >= MIN_POSITION) {
    return [{ channelId: movedId, position: between }];
  }

  return next.flatMap((key, index) => {
    const channel = byId.get(key)!;
    const position = index * SPACING;
    return channel.position === position ? [] : [{ channelId: channel.id, position }];
  });
}

/** One sibling and the rows it carries with it: itself and everything under it. */
export interface SiblingBlock {
  channelId: number;
  /** Index of the channel's own row in the ordered list. */
  first: number;
  /** Index of the last row of its subtree, inclusive. */
  last: number;
}

/**
 * The sibling groups of `channelId`, as spans of the rendered tree.
 *
 * A channel that moves takes its sub-channels with it, so what the pointer is
 * judged against is each sibling's whole subtree rather than its row alone.
 */
export function siblingBlocks(entries: readonly OrderedChannel[], channelId: number): SiblingBlock[] {
  const moved = entries.find((entry) => entry.channel.id === channelId);
  if (!moved) return [];
  const blocks: SiblingBlock[] = [];
  entries.forEach((entry, index) => {
    if (entry.depth !== moved.depth || entry.channel.parent_id !== moved.channel.parent_id) return;
    let last = index;
    while (last + 1 < entries.length && entries[last + 1].depth > entry.depth) last += 1;
    blocks.push({ channelId: entry.channel.id, first: index, last });
  });
  return blocks;
}

/**
 * Whether a row can be picked up, and if not, why: it needs a sibling to trade
 * places with ("alone" - the root channel always is), and the right to change
 * its own position ("denied"). Unknown permissions count as allowed, as the
 * editor does - the server has the last word either way.
 */
export type ArrangeState = "movable" | "alone" | "denied";

export function arrangeState(entries: readonly OrderedChannel[], channel: ChannelEntry): ArrangeState {
  if (siblingBlocks(entries, channel.id).length < 2) return "alone";
  if (channel.permissions != null && (channel.permissions & PERM_WRITE) === 0) return "denied";
  return "movable";
}

export function canArrange(entries: readonly OrderedChannel[], channel: ChannelEntry): boolean {
  return arrangeState(entries, channel) === "movable";
}
