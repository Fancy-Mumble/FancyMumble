import type { ChannelEntry } from "../../types";

/**
 * Where a registered user was last, as the admin table names it.
 *
 * The server's user list carries only the channel's id; the client holds the
 * channel list, so the id is read against it: a channel that still exists is
 * named (the root one by its own name), one that no longer does is said to
 * be deleted, and a user the server has no channel for is unknown.
 */
export type LastChannel =
  | { kind: "named"; name: string }
  | { kind: "deleted" }
  | { kind: "unknown" };

export function lastChannel(id: number | null | undefined, channels: readonly ChannelEntry[]): LastChannel {
  if (id == null) return { kind: "unknown" };
  const channel = channels.find((entry) => entry.id === id);
  return channel ? { kind: "named", name: channel.name } : { kind: "deleted" };
}

/** Sort rank: named channels first (by name), then deleted ones, then unknown. */
const RANK: Record<LastChannel["kind"], number> = { named: 0, deleted: 1, unknown: 2 };

/** Order two users' last channels by what the table shows, not by id. */
export function compareLastChannels(left: LastChannel, right: LastChannel): number {
  if (left.kind !== right.kind) return RANK[left.kind] - RANK[right.kind];
  return left.kind === "named" && right.kind === "named"
    ? left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
    : 0;
}
