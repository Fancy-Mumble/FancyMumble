import { describe, expect, it } from "vitest";
import type { ChannelEntry, SessionMeta, UserEntry } from "@core/types";
import type { Friend } from "@core/friendsStorage";
import {
  dmChannelLabel,
  isFriendChatOpen,
  listFriendGroups,
  reachFriend,
  selfFriend,
  SELF_FRIEND_PREFIX,
  type FriendEntry,
  type FriendMatch,
} from "./friends";

function friend(partial: Partial<Friend> & { id: string; userName: string }): Friend {
  return { addedAt: 0, ...partial };
}

function session(partial: Partial<SessionMeta> & { id: string }): SessionMeta {
  return {
    label: `label-${partial.id}`,
    host: "magical.rocks",
    port: 64738,
    username: "Sebi",
    certLabel: null,
    status: "connected",
    ...partial,
  };
}

function user(partial: Partial<UserEntry> & { session: number; name: string }): UserEntry {
  return {
    channel_id: 0,
    texture_size: null,
    mute: false,
    deaf: false,
    suppress: false,
    self_mute: false,
    self_deaf: false,
    priority_speaker: false,
    ...partial,
  } as UserEntry;
}

function match(partial: Partial<FriendMatch> & { serverId: string }): FriendMatch {
  return { userSession: 7, userName: "ZewiWin", ...partial };
}

const OPEN = session({ id: "s1", label: "Magical" });

describe("reachFriend", () => {
  it("reaches a friend seen online through the session they were seen on", () => {
    const result = reachFriend(friend({ id: "f1", userName: "ZewiWin" }), match({ serverId: "s1" }), [OPEN]);
    expect(result).toEqual({ sessionId: "s1", canOpen: true, canConnect: false });
  });

  it("opens a registered friend who is offline on a server that is already open", () => {
    const away = friend({
      id: "f1",
      userName: "ZewiWin",
      userId: 4,
      serverHost: "magical.rocks",
      serverPort: 64738,
      serverUsername: "Sebi",
    });
    // Their chat is a persisted room, so there is something to open with nobody
    // on the other side of it.
    expect(reachFriend(away, null, [OPEN])).toEqual({
      sessionId: "s1",
      canOpen: true,
      canConnect: false,
    });
  });

  it("offers to connect when the friend's server is not open", () => {
    const elsewhere = friend({
      id: "f1",
      userName: "ZewiWin",
      userId: 4,
      serverHost: "voice.kumo.gg",
      serverPort: 64738,
      serverUsername: "Sebi",
    });
    expect(reachFriend(elsewhere, null, [OPEN])).toEqual({
      sessionId: null,
      canOpen: false,
      canConnect: true,
    });
  });

  it("can do nothing at all for an anonymous friend with no saved server", () => {
    expect(reachFriend(friend({ id: "f1", userName: "Guest" }), null, [OPEN])).toEqual({
      sessionId: null,
      canOpen: false,
      canConnect: false,
    });
  });

  it("does not count a session that is still connecting as reachable", () => {
    const away = friend({
      id: "f1",
      userName: "ZewiWin",
      userId: 4,
      serverHost: "magical.rocks",
      serverPort: 64738,
      serverUsername: "Sebi",
    });
    const connecting = [session({ id: "s1", status: "connecting" })];
    expect(reachFriend(away, null, connecting).canOpen).toBe(false);
  });
});

describe("listFriendGroups", () => {
  const base = {
    online: {} as Record<string, FriendMatch>,
    sessions: [OPEN],
    users: [] as UserEntry[],
    activeServerId: "s1",
    unreadCounts: {} as Record<number, number>,
    query: "",
  };

  it("lists the saved friends rather than whoever is on the server", () => {
    // The users on the connection are deliberately not the friends: a roster is
    // not a friends list, which is the whole point of this screen.
    const groups = listFriendGroups({
      ...base,
      users: [user({ session: 9, name: "Stranger" })],
      friends: [friend({ id: "f1", userName: "ZewiWin", serverLabel: "Magical" })],
    });
    expect(groups.flatMap((group) => group.entries.map((entry) => entry.friend.userName))).toEqual([
      "ZewiWin",
    ]);
  });

  it("keeps one group per server however many sessions the friends were added on", () => {
    const groups = listFriendGroups({
      ...base,
      friends: [
        friend({ id: "f1", userName: "ZewiWin", serverId: "old-uuid", serverLabel: "Magical" }),
        friend({ id: "f2", userName: "Ada", serverId: "new-uuid", serverLabel: "Magical" }),
      ],
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].entries).toHaveLength(2);
  });

  it("puts the server you are on first", () => {
    const groups = listFriendGroups({
      ...base,
      friends: [
        friend({ id: "f1", userName: "Ada", serverLabel: "Kumo" }),
        friend({ id: "f2", userName: "ZewiWin", serverLabel: "Magical" }),
      ],
    });
    expect(groups.map((group) => group.label)).toEqual(["Magical", "Kumo"]);
  });

  it("floats yourself, then anyone waiting, then whoever is here", () => {
    const groups = listFriendGroups({
      ...base,
      online: {
        f2: match({ serverId: "s1", userSession: 7 }),
        f3: match({ serverId: "s1", userSession: 8 }),
      },
      unreadCounts: { 8: 3 },
      friends: [
        friend({ id: "f1", userName: "Ada", serverLabel: "Magical" }),
        friend({ id: "f2", userName: "Here", serverLabel: "Magical" }),
        friend({ id: "f3", userName: "Waiting", serverLabel: "Magical" }),
        friend({ id: `${SELF_FRIEND_PREFIX}s1`, userName: "Sebi", serverLabel: "Magical" }),
      ],
    });
    expect(groups[0].entries.map((entry) => entry.friend.userName)).toEqual([
      "Sebi",
      "Waiting",
      "Here",
      "Ada",
    ]);
  });

  it("counts waiting messages only for a friend we can actually see", () => {
    // The count is keyed by session, and an offline friend has none - reading
    // one off a stale session would attribute somebody else's thread to them.
    const groups = listFriendGroups({
      ...base,
      unreadCounts: { 7: 2 },
      friends: [friend({ id: "f1", userName: "ZewiWin", serverLabel: "Magical" })],
    });
    expect(groups[0].entries[0].unread).toBe(0);
  });

  it("attaches the live entry only for a friend on the active server", () => {
    const groups = listFriendGroups({
      ...base,
      online: { f1: match({ serverId: "s2", userSession: 7 }) },
      sessions: [OPEN, session({ id: "s2", label: "Kumo", host: "voice.kumo.gg" })],
      users: [user({ session: 7, name: "ZewiWin" })],
      friends: [friend({ id: "f1", userName: "ZewiWin", serverLabel: "Kumo" })],
    });
    // Session numbers are per-connection, so the active server's user list says
    // nothing about a friend found on another one.
    expect(groups[0].entries[0].live).toBeNull();
    expect(groups[0].entries[0].match).not.toBeNull();
  });

  it("searches the server name as well as the person's", () => {
    const friends = [
      friend({ id: "f1", userName: "Ada", serverLabel: "Kumo" }),
      friend({ id: "f2", userName: "ZewiWin", serverLabel: "Magical" }),
    ];
    expect(
      listFriendGroups({ ...base, friends, query: "kum" }).flatMap((group) =>
        group.entries.map((entry) => entry.friend.userName),
      ),
    ).toEqual(["Ada"]);
    expect(
      listFriendGroups({ ...base, friends, query: "zewi" }).flatMap((group) =>
        group.entries.map((entry) => entry.friend.userName),
      ),
    ).toEqual(["ZewiWin"]);
  });
});

describe("selfFriend", () => {
  const registered = user({ session: 3, name: "Sebi", user_id: 4 });

  it("lists you as a friend when the notepad can exist", () => {
    const self = selfFriend({
      activeServerId: "s1",
      ownUser: registered,
      sessions: [OPEN],
      hasFriendsPlugin: true,
    });
    expect(self?.userName).toBe("Sebi");
    expect(self?.userId).toBe(4);
    // The label is what groups it under the server you are on.
    expect(self?.serverLabel).toBe("Magical");
  });

  it("is absent without the plugin that would provision the room", () => {
    expect(
      selfFriend({ activeServerId: "s1", ownUser: registered, sessions: [OPEN], hasFriendsPlugin: false }),
    ).toBeNull();
  });

  it("is absent for a guest, who has no registered id to name a room after", () => {
    const guest = user({ session: 3, name: "Sebi", user_id: null });
    expect(
      selfFriend({ activeServerId: "s1", ownUser: guest, sessions: [OPEN], hasFriendsPlugin: true }),
    ).toBeNull();
  });
});

describe("isFriendChatOpen", () => {
  const entry = (partial: Partial<FriendEntry>): FriendEntry => ({
    friend: friend({ id: "f1", userName: "ZewiWin", userId: 4 }),
    match: null,
    live: null,
    sessionId: "s1",
    canOpen: true,
    canConnect: false,
    unread: 0,
    self: false,
    ...partial,
  });
  const room = { id: 12, name: "__dm:2-4", detached: true } as ChannelEntry;
  const state = {
    selectedDmUser: null,
    selectedChannel: null,
    activeServerId: "s1",
    channels: [room],
    ownUserId: 2,
  };

  it("marks the row while the classic direct message is the open one", () => {
    const open = entry({ match: match({ serverId: "s1", userSession: 7 }) });
    expect(isFriendChatOpen(open, { ...state, selectedDmUser: 7 })).toBe(true);
  });

  it("stays marked once the chat upgrades to the pair's room", () => {
    // The upgrade clears `selectedDmUser` and selects a channel instead; a row
    // that only watched the session would unhighlight itself mid-conversation.
    expect(isFriendChatOpen(entry({}), { ...state, selectedChannel: 12 })).toBe(true);
  });

  it("does not mark a friend whose room merely exists on another server", () => {
    const open = entry({ match: match({ serverId: "s2", userSession: 7 }) });
    expect(isFriendChatOpen(open, { ...state, selectedDmUser: 7 })).toBe(false);
  });

  it("does not mark anyone for an ordinary channel", () => {
    const lounge = { id: 5, name: "Lounge" } as ChannelEntry;
    expect(isFriendChatOpen(entry({}), { ...state, channels: [lounge], selectedChannel: 5 })).toBe(false);
  });
});

describe("dmChannelLabel", () => {
  const room = { id: 12, name: "__dm:2-4", detached: true } as ChannelEntry;

  it("names the room after the peer while they are here", () => {
    const label = dmChannelLabel(room, {
      users: [user({ session: 7, name: "ZewiWin", user_id: 4 })],
      friends: [],
      ownUserId: 2,
    });
    expect(label).toBe("ZewiWin");
  });

  it("falls back to the saved friend when they are not", () => {
    // The common case: the room is persisted precisely so it can be read while
    // the friend is away, and there is no live user to take a name from.
    const label = dmChannelLabel(room, {
      users: [],
      friends: [friend({ id: "f1", userName: "ZewiWin", userId: 4 })],
      ownUserId: 2,
    });
    expect(label).toBe("ZewiWin");
  });

  it("names a self-notepad after you", () => {
    const notepad = { id: 13, name: "__dm:2", detached: true } as ChannelEntry;
    const label = dmChannelLabel(notepad, {
      users: [user({ session: 3, name: "Sebi", user_id: 2 })],
      friends: [],
      ownUserId: 2,
    });
    expect(label).toBe("Sebi");
  });

  it("says nothing about a channel that is not a friend chat", () => {
    const lounge = { id: 5, name: "Lounge" } as ChannelEntry;
    expect(dmChannelLabel(lounge, { users: [], friends: [], ownUserId: 2 })).toBeNull();
  });
});
