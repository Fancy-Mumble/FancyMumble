import { describe, it, expect } from "vitest";
import { filterVisibleChannels } from "../../utils/channelVisibility";
import type { ChannelEntry, UserEntry } from "../../types";

function ch(id: number, parentId: number | null, name = `ch${id}`): ChannelEntry {
  return {
    id,
    parent_id: parentId,
    name,
    description_size: null,
    user_count: 0,
    permissions: null,
    temporary: false,
    position: id,
    max_users: 0,
  };
}

function user(session: number, channelId: number): UserEntry {
  return { session, name: `u${session}`, channel_id: channelId, texture_size: null, comment: null,
    mute: false, deaf: false } as UserEntry;
}

const NONE = { currentChannel: null, selectedChannel: null, listenedChannels: new Set<number>() };

describe("filterVisibleChannels", () => {
  it("drops channels with no members", () => {
    const channels = [ch(0, null), ch(1, 0), ch(2, 0)];
    // root(0) and ch1 populated; ch2 empty.
    const result = filterVisibleChannels(channels, [user(0, 0), user(1, 1)], NONE);
    expect(result.map((c) => c.id).sort()).toEqual([0, 1]); // ch2 (empty) dropped
  });

  it("hides an empty parent and re-parents its populated child to root", () => {
    // root(0, empty) > parent(1, empty) > child(2, populated)
    const channels = [ch(0, null), ch(1, 0), ch(2, 1)];
    const result = filterVisibleChannels(channels, [user(1, 2)], NONE);
    expect(result.map((c) => c.id)).toEqual([2]);
    expect(result[0].parent_id).toBeNull(); // lifted to root, parent 1 hidden
  });

  it("re-parents onto the nearest *visible* ancestor", () => {
    // root(0, populated) > parent(1, empty) > child(2, populated)
    const channels = [ch(0, null), ch(1, 0), ch(2, 1)];
    const result = filterVisibleChannels(channels, [user(1, 0), user(2, 2)], NONE);
    expect(result.map((c) => c.id).sort()).toEqual([0, 2]);
    expect(result.find((c) => c.id === 2)?.parent_id).toBe(0); // skips empty parent 1
  });

  it("keeps the current/selected/listened channels even when empty", () => {
    const channels = [ch(0, null), ch(1, 0), ch(2, 0), ch(3, 0)];
    const result = filterVisibleChannels(channels, [], {
      currentChannel: 1,
      selectedChannel: 2,
      listenedChannels: new Set([3]),
    });
    expect(result.map((c) => c.id).sort()).toEqual([1, 2, 3]);
  });

  it("returns originals unchanged when no re-parenting is needed", () => {
    const channels = [ch(0, null), ch(1, 0)];
    // Both populated, so ch1's visible parent (root) is unchanged.
    const result = filterVisibleChannels(channels, [user(0, 0), user(1, 1)], NONE);
    expect(result.find((c) => c.id === 1)).toBe(channels[1]); // same reference
  });

  it("hides an empty root, lifting its populated child to the top level", () => {
    const channels = [ch(0, null), ch(1, 0)];
    const result = filterVisibleChannels(channels, [user(1, 1)], NONE);
    expect(result.map((c) => c.id)).toEqual([1]); // empty root dropped
    expect(result[0].parent_id).toBeNull();
  });
});
