import type { ChannelEntry } from "@core/types";

/**
 * Flattens the channel tree into a single depth-first list.
 *
 * The hierarchy still decides the *order* (a parent is immediately followed by
 * its descendants, each level sorted by server `position` then name), but the
 * result carries no depth, so the viewer renders every channel at one level.
 * Mirrors the ordering of the standard client's flat channel list.
 */
export function flattenChannels(channels: ChannelEntry[]): ChannelEntry[] {
  const childrenOf = new Map<number, ChannelEntry[]>();
  const ids = new Set(channels.map((channel) => channel.id));
  for (const channel of channels) {
    // Self-parented rows are roots, as are channels whose parent is filtered out.
    const parent =
      channel.parent_id === null || channel.parent_id === channel.id || !ids.has(channel.parent_id)
        ? -1
        : channel.parent_id;
    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), channel]);
  }
  for (const siblings of childrenOf.values()) {
    siblings.sort((left, right) => left.position - right.position || left.name.localeCompare(right.name));
  }

  const result: ChannelEntry[] = [];
  const seen = new Set<number>();
  const visit = (parent: number) => {
    for (const channel of childrenOf.get(parent) ?? []) {
      // Guards against a parent cycle in server data looping forever.
      if (seen.has(channel.id)) continue;
      seen.add(channel.id);
      result.push(channel);
      visit(channel.id);
    }
  };
  visit(-1);

  // A parent cycle (A -> B -> A) leaves its members unreachable from any root,
  // and would otherwise vanish from the viewer entirely. Append the stragglers
  // in server order so malformed data still lists every channel.
  if (result.length !== channels.length) {
    for (const channel of [...channels].sort(
      (left, right) => left.position - right.position || left.name.localeCompare(right.name),
    )) {
      if (seen.has(channel.id)) continue;
      seen.add(channel.id);
      result.push(channel);
    }
  }
  return result;
}
