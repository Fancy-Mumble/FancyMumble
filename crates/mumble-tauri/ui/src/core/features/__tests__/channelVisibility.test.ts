import { describe, it, expect } from "vitest";
import {
  filterVisibleChannels,
  filterMeetingChannels,
  meetingRooms,
  channelDisplayName,
  usersForChannelTree,
} from "../../utils/channelVisibility";
import type { ChannelEntry, UserEntry } from "../../types";

function ch(
  id: number,
  parentId: number | null,
  name = `ch${id}`,
  opts: { hidden?: boolean; detached?: boolean } = {},
): ChannelEntry {
  return {
    id,
    parent_id: parentId,
    name,
    description_size: null,
    user_count: 0,
    permissions: null,
    temporary: false,
    hidden: opts.hidden ?? false,
    detached: opts.detached ?? false,
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

describe("meeting rooms (detached channels)", () => {
  // Detached meeting rooms are parentless (parent_id == null) and carry the
  // detached flag; the server never places them in the tree.
  const tree = [
    ch(0, null, "Root"),
    ch(1, 0, "General"),
    ch(3, null, "Standup [a1b2c3d4]", { detached: true }),
    ch(4, null, "Review [e5f6a7b8]", { detached: true }),
  ];

  it("identifies detached channels as meeting rooms", () => {
    expect(meetingRooms(tree).map((c) => c.id).sort()).toEqual([3, 4]);
  });

  it("does not treat an ordinary (non-detached) channel as a meeting room", () => {
    const t = [ch(0, null, "Root"), ch(5, 0, "Secret", { hidden: true })];
    expect(meetingRooms(t)).toEqual([]);
  });

  it("filterMeetingChannels drops detached channels from the tree", () => {
    expect(filterMeetingChannels(tree).map((c) => c.id).sort()).toEqual([0, 1]);
  });

  it("returns the list unchanged when there are no detached channels", () => {
    const t = [ch(0, null), ch(1, 0)];
    expect(filterMeetingChannels(t)).toBe(t);
  });
});

describe("channelDisplayName", () => {
  it("strips the disambiguation suffix from a detached meeting room", () => {
    expect(channelDisplayName(ch(3, null, "Sprint Review [a1b2c3d4]", { detached: true }))).toBe(
      "Sprint Review",
    );
  });

  it("still strips for a hidden (private) room", () => {
    expect(channelDisplayName(ch(3, 0, "Project [x] [a1b2c3d4]", { hidden: true }))).toBe("Project [x]");
  });

  it("leaves a detached room without a suffix unchanged", () => {
    expect(channelDisplayName(ch(3, null, "Sprint Review", { detached: true }))).toBe("Sprint Review");
  });

  it("never alters an ordinary channel (even one ending in brackets)", () => {
    expect(channelDisplayName(ch(1, 0, "Build [nightly]"))).toBe("Build [nightly]");
  });

  it("falls back to the full name when stripping would empty it", () => {
    expect(channelDisplayName(ch(3, null, "[a1b2c3d4]", { detached: true }))).toBe("[a1b2c3d4]");
  });
});

describe("usersForChannelTree (friend-chat occupants stay in the channel list)", () => {
  // Regression guard: opening a friend chat / self-notepad joins you into a
  // detached `__dm:` channel which the tree never renders and the meetings
  // viewer excludes. Without remapping its occupants to root, the local user
  // vanishes from the channel list entirely (vanilla roots them instead).
  const SENTINEL = 0xffffffff; // PRESENCE_HIDDEN_CHANNEL - presence-hidden sentinel
  const chOf = (users: UserEntry[], session: number) =>
    users.find((u) => u.session === session)?.channel_id;

  it("remaps a user sitting in their own __dm: self-notepad to the root channel", () => {
    // Channel 7 is the local user's detached self-notepad; they joined it on
    // opening the chat, so their channel_id points at it.
    const channels = [ch(0, null, "Root"), ch(7, null, "__dm:5", { detached: true })];
    const out = usersForChannelTree(channels, [user(1, 7)]);
    expect(chOf(out, 1)).toBe(0); // grouped under root, not the hidden DM room
  });

  it("remaps both occupants of a friend (__dm:<lo>-<hi>) room to root", () => {
    const channels = [ch(0, null, "Root"), ch(9, null, "__dm:5-8", { detached: true })];
    const out = usersForChannelTree(channels, [user(1, 9), user(2, 9)]);
    expect(chOf(out, 1)).toBe(0);
    expect(chOf(out, 2)).toBe(0);
  });

  it("does NOT mutate the input user entries", () => {
    const channels = [ch(0, null, "Root"), ch(7, null, "__dm:5", { detached: true })];
    const original = user(1, 7);
    usersForChannelTree(channels, [original]);
    expect(original.channel_id).toBe(7); // store entry untouched (cloned for the tree)
  });

  it("does NOT remap an ordinary detached meeting room (only __dm: rooms)", () => {
    // A meeting room occupant is surfaced in the meetings viewer, so it must stay
    // under its own id - remapping it to root would double-show it.
    const channels = [ch(0, null, "Root"), ch(4, null, "Standup [abcd]", { detached: true })];
    const out = usersForChannelTree(channels, [user(1, 4)]);
    expect(chOf(out, 1)).toBe(4);
  });

  it("keeps a presence-hidden (sentinel) user under the sentinel id (out of the tree)", () => {
    const out = usersForChannelTree([ch(0, null, "Root")], [user(9, SENTINEL)]);
    expect(chOf(out, 9)).toBe(SENTINEL); // never leaked to root
  });

  it("returns the same array reference when there are no DM rooms", () => {
    const usersIn = [user(1, 0), user(2, 1)];
    expect(usersForChannelTree([ch(0, null), ch(1, 0)], usersIn)).toBe(usersIn);
  });
});
