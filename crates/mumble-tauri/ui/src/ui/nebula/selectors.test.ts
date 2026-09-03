import { describe, expect, it } from "vitest";
import { useTranslation } from "react-i18next";
import { hexToHsl } from "@core/utils/colorUtils";
import type {
  AclGroup,
  ChannelEntry,
  ConnectionStatus,
  SearchResult,
  UserEntry,
} from "@core/types";
import {
  channelOccupants,
  channelPresence,
  composerHtml,
  editableText,
  messageContent,
  groupMessagesByDay,
  groupSavedServers,
  isEncryptedChannel,
  orderChannels,
  preferredIdentity,
  presenceLabel,
  quickConnectTargets,
  quickSwitchTargets,
  reorderServerRail,
  rosterGroups,
  serverRailEntries,
  globalSearchRows,
  formatLastJoined,
  serverTint,
  splitBodyImages,
} from "./selectors";

function channel(partial: Partial<ChannelEntry> & { id: number }): ChannelEntry {
  return {
    parent_id: partial.id === 0 ? null : 0,
    name: `channel-${partial.id}`,
    description_size: null,
    user_count: 0,
    permissions: null,
    temporary: false,
    position: 0,
    max_users: 0,
    ...partial,
  } as ChannelEntry;
}

function user(session: number, name: string, channelId = 0): UserEntry {
  return {
    session,
    name,
    channel_id: channelId,
    texture_size: null,
    mute: false,
    deaf: false,
    suppress: false,
    self_mute: false,
    self_deaf: false,
    priority_speaker: false,
  } as UserEntry;
}

/** The suite-wide react-i18next mock answers from the real English
 *  catalogue, so these assertions stay written in English. */
const { t } = useTranslation("nebulaCommon");

describe("orderChannels", () => {
  const tree = [
    channel({ id: 0, name: "Root", parent_id: null }),
    channel({ id: 2, name: "Gaming", parent_id: 0, position: 200 }),
    channel({ id: 1, name: "Lounge", parent_id: 0, position: 100 }),
    channel({ id: 3, name: "Ranked", parent_id: 2 }),
  ];

  it("walks the tree in position order and reports indent depth", () => {
    expect(
      orderChannels({
        channels: tree,
        query: "",
        hideEmpty: false,
        currentChannel: null,
        selectedChannel: null,
      }),
    ).toEqual([
      { channel: expect.objectContaining({ id: 0 }), depth: 0 },
      { channel: expect.objectContaining({ id: 1 }), depth: 1 },
      { channel: expect.objectContaining({ id: 2 }), depth: 1 },
      { channel: expect.objectContaining({ id: 3 }), depth: 2 },
    ]);
  });

  it("keeps the ancestors of a match so a deep hit is never orphaned", () => {
    const result = orderChannels({
      channels: tree,
      query: "ranked",
      hideEmpty: false,
      currentChannel: null,
      selectedChannel: null,
    });
    expect(result.map((entry) => entry.channel.id)).toEqual([0, 2, 3]);
  });

  it("keeps the joined and selected channels when empty ones are hidden", () => {
    const result = orderChannels({
      channels: tree,
      query: "",
      hideEmpty: true,
      currentChannel: 3,
      selectedChannel: 1,
    });
    expect(result.map((entry) => entry.channel.id)).toEqual([0, 1, 2, 3]);
  });

  it("drops detached channels, which are never part of the tree", () => {
    const result = orderChannels({
      channels: [...tree, channel({ id: 9, name: "Meeting", detached: true })],
      query: "",
      hideEmpty: false,
      currentChannel: null,
      selectedChannel: null,
    });
    expect(result.some((entry) => entry.channel.id === 9)).toBe(false);
  });
});

describe("channelOccupants", () => {
  it("sorts by name and ignores who is talking", () => {
    const users = [user(1, "Zoe", 4), user(2, "Adam", 4), user(3, "Mia", 4), user(4, "Elsewhere", 5)];
    expect(channelOccupants(users, 4).map((entry) => entry.name)).toEqual(["Adam", "Mia", "Zoe"]);
  });
});

function role(name: string, add: number[], color: string | null = null): AclGroup {
  return {
    name,
    inherited: false,
    inherit: true,
    inheritable: true,
    add,
    remove: [],
    inherited_members: [],
    color,
  };
}

describe("rosterGroups", () => {
  const rooms = [channel({ id: 4, name: "Gaming" }), channel({ id: 5, name: "Lounge" })];
  const here = [{ ...user(1, "Zoe", 4), user_id: 20 }, { ...user(2, "Adam", 4), user_id: 10 }];
  const elsewhere = [{ ...user(3, "enot", 5), user_id: 30 }];
  const absent = [{ ...user(-12, "Lyroit", 0), user_id: 11 }];
  const roles = [role("admin", [10], "#41b4f9"), role("mods", [20, 11])];

  const input = (over: Partial<Parameters<typeof rosterGroups>[0]> = {}) =>
    rosterGroups({
      users: [...here, ...elsewhere],
      registered: absent,
      roles,
      channels: rooms,
      query: "",
      selectedChannel: 4,
      showOffline: true,
      ...over,
    });

  it("puts the open channel first, then the server's roles in ACL order", () => {
    expect(input().map((group) => [group.kind, group.label])).toEqual([
      ["channel", ""],
      ["role", "admin"],
      ["role", "mods"],
      ["members", ""],
    ]);
  });

  it("lists the open channel's occupants alphabetically", () => {
    expect(input()[0].members.map((member) => member.user.name)).toEqual(["Adam", "Zoe"]);
  });

  it("draws someone in your channel under their role as well", () => {
    const admin = input().find((group) => group.label === "admin");
    expect(admin?.members.map((member) => member.user.name)).toEqual(["Adam"]);
  });

  it("carries the role's own colour to its heading", () => {
    const admin = input().find((group) => group.label === "admin");
    expect(admin?.color).toBe("#41b4f9");
  });

  it("says which channel someone outside the open one is in", () => {
    const members = input().find((group) => group.kind === "members");
    expect(members?.members.map((member) => [member.user.name, member.channel])).toEqual([
      ["enot", "Lounge"],
    ]);
  });

  it("sorts an absent member after the connected ones and places them nowhere", () => {
    const mods = input().find((group) => group.label === "mods");
    expect(mods?.members.map((member) => [member.user.name, member.offline, member.channel])).toEqual([
      ["Zoe", false, "Gaming"],
      ["Lyroit", true, null],
    ]);
  });

  it("drops a registered user who is connected from the offline rows", () => {
    const connected = { ...user(9, "Lyroit", 5), user_id: 11 };
    const groups = input({ users: [...here, connected] });
    const mods = groups.find((group) => group.label === "mods");
    expect(mods?.members.map((member) => [member.user.name, member.offline])).toEqual([
      ["Lyroit", false],
      ["Zoe", false],
    ]);
  });

  it("leaves the registration table out when it is switched off", () => {
    const groups = input({ showOffline: false });
    const mods = groups.find((group) => group.label === "mods");
    expect(mods?.members.map((member) => member.user.name)).toEqual(["Zoe"]);
  });

  it("files an unregistered user under guests, whatever the roles say", () => {
    const groups = input({ users: [...here, user(8, "drifter", 5)], roles: [] });
    expect(groups.map((group) => group.kind)).toEqual(["channel", "members", "guests"]);
    expect(groups[2].members.map((member) => member.user.name)).toEqual(["drifter"]);
  });

  it("searches every group, offline members included", () => {
    const groups = input({ query: "ly" });
    expect(groups.map((group) => [group.label, group.members.map((member) => member.user.name)])).toEqual(
      [["mods", ["Lyroit"]]],
    );
  });
});

describe("channelPresence", () => {
  const holder = (cert_hash: string, name: string) => ({ cert_hash, name, is_online: false });
  const here = [
    { ...user(1, "Zoe", 4), hash: "aa" },
    { ...user(2, "Adam", 4), hash: "bb" },
    { ...user(3, "Elsewhere", 5), hash: "cc" },
  ];

  it("counts a plain channel as its occupants and nothing more", () => {
    expect(channelPresence(here, 4)).toEqual({ inVoice: 2, members: 2 });
  });

  it("adds the key holders who are not in the channel", () => {
    const holders = [holder("aa", "Zoe"), holder("dd", "Sebi"), holder("ee", "Mia")];
    expect(channelPresence(here, 4, holders)).toEqual({ inVoice: 2, members: 4 });
  });

  it("keeps counting a holder who is connected but sitting elsewhere", () => {
    const holders = [holder("cc", "Elsewhere")];
    expect(channelPresence(here, 4, holders)).toEqual({ inVoice: 2, members: 3 });
  });
});

describe("presenceLabel", () => {
  it("says both numbers when they differ", () => {
    expect(presenceLabel(t, { inVoice: 3, members: 5 })).toBe("3 in voice · 5 members");
  });

  it("drops the membership when it only restates who is present", () => {
    expect(presenceLabel(t, { inVoice: 5, members: 5 })).toBe("5 in voice");
  });

  it("counts one member singly", () => {
    expect(presenceLabel(t, { inVoice: 0, members: 1 })).toBe("0 in voice · 1 member");
  });

  it("says an empty channel is empty", () => {
    expect(presenceLabel(t, { inVoice: 0, members: 0 })).toBe("Nobody here");
  });
});

describe("isEncryptedChannel", () => {
  it("reads the announced protocol", () => {
    expect(isEncryptedChannel(channel({ id: 1, pchat_protocol: "signal_v1" }))).toBe(true);
    expect(isEncryptedChannel(channel({ id: 1, pchat_protocol: "fancy_v1_full_archive" }))).toBe(true);
  });

  it("claims nothing for a channel that announces none", () => {
    expect(isEncryptedChannel(channel({ id: 1, pchat_protocol: "none" }))).toBe(false);
    expect(isEncryptedChannel(channel({ id: 1 }))).toBe(false);
    expect(isEncryptedChannel(null)).toBe(false);
  });
});

describe("groupMessagesByDay", () => {
  const now = new Date("2026-08-22T20:00:00Z");
  const at = (iso: string) => ({ timestamp: new Date(iso).getTime() });

  it("labels the current and previous day by name", () => {
    const sections = groupMessagesByDay(t, [at("2026-08-21T10:00:00"), at("2026-08-22T10:00:00")], now);
    expect(sections.map((section) => section.label)).toEqual(["Yesterday", "Today"]);
  });

  it("keeps timestamp-less legacy messages in the open section", () => {
    const sections = groupMessagesByDay(t, [at("2026-08-22T10:00:00"), { timestamp: null }], now);
    expect(sections).toHaveLength(1);
    expect(sections[0].messages).toHaveLength(2);
  });
});

describe("groupSavedServers", () => {
  const saved = (id: string, host: string, username: string, favorite = false) =>
    ({ id, label: host, host, port: 64738, username, cert_label: null, favorite }) as never;

  it("lists a server once however many identities are saved for it", () => {
    const groups = groupSavedServers([
      saved("a", "magical.rocks", "Sebi"),
      saved("b", "magical.rocks", "FancyZewi"),
      saved("c", "voice.kumo.gg", "Sebi"),
    ]);
    expect(groups.map((group) => group.label)).toEqual(["magical.rocks", "voice.kumo.gg"]);
    expect(groups[0].identities.map((identity) => identity.username)).toEqual(["FancyZewi", "Sebi"]);
  });

  it("treats the address case-insensitively", () => {
    const groups = groupSavedServers([
      saved("a", "Magical.Rocks", "Sebi"),
      saved("b", "magical.rocks", "Zewi"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].identities).toHaveLength(2);
  });

  it("marks the server as a favourite when any of its identities is, and floats it", () => {
    const groups = groupSavedServers([
      saved("a", "zzz.example", "Sebi"),
      saved("b", "magical.rocks", "Sebi"),
      saved("c", "magical.rocks", "Zewi", true),
    ]);
    expect(groups[0].label).toBe("magical.rocks");
    expect(groups[0].favorite).toBe(true);
    expect(groups[1].favorite).toBe(false);
  });

  it("leaves an address unattached when its only session has disconnected", () => {
    const groups = groupSavedServers(
      [saved("a", "magical.rocks", "Sebi")],
      [{ id: "sess", host: "magical.rocks", port: 64738, username: "Sebi", status: "disconnected" }],
    );
    // Otherwise the sidebar would call a dead tab "connected" and switching to
    // it would land the user in a session that is not there.
    expect(groups[0].sessionId).toBeNull();
  });

  it("attaches the live session to the address that is connected", () => {
    const groups = groupSavedServers(
      [saved("a", "magical.rocks", "Sebi"), saved("b", "voice.kumo.gg", "Sebi")],
      [{ id: "sess", host: "magical.rocks", port: 64738, username: "Sebi" }],
    );
    expect(groups.find((group) => group.host === "magical.rocks")?.sessionId).toBe("sess");
    expect(groups.find((group) => group.host === "voice.kumo.gg")?.sessionId).toBeNull();
  });
});

describe("serverTint", () => {
  it("gives one address the same pair every time", () => {
    expect(serverTint("magical.rocks:64738")).toEqual(serverTint("MAGICAL.ROCKS:64738"));
  });

  it("puts addresses that differ by one character in visibly different hues", () => {
    const hues = ["srv1:64738", "srv2:64738", "srv3:64738"].map((key) => hexToHsl(serverTint(key).from).h);
    for (const [left, right] of [
      [hues[0], hues[1]],
      [hues[1], hues[2]],
      [hues[0], hues[2]],
    ]) {
      const apart = Math.abs(left - right);
      expect(Math.min(apart, 360 - apart)).toBeGreaterThan(20);
    }
  });

  it("keeps every pair at the mock's muted tone", () => {
    for (const key of ["localhost:64738", "voice.kumo.gg:64738", "a", ""]) {
      const { from, to } = serverTint(key);
      expect(from).toMatch(/^#[0-9a-f]{6}$/);
      expect(hexToHsl(from)).toMatchObject({ s: 23, l: 46 });
      expect(hexToHsl(to)).toMatchObject({ s: 23, l: 46 });
    }
  });
});

describe("quickConnectTargets", () => {
  const saved = (
    id: string,
    host: string,
    username: string,
    extra: { favorite?: boolean; last_joined?: number } = {},
  ) =>
    ({
      id,
      label: host,
      host,
      port: 64738,
      username,
      cert_label: null,
      favorite: false,
      ...extra,
    }) as never;

  const session = (id: string, host: string, username: string, status: ConnectionStatus = "connected") => ({
    id,
    host,
    port: 64738,
    username,
    status,
  });

  const hosts = (targets: ReturnType<typeof quickConnectTargets>) =>
    targets.map((target) => target.group.host);

  it("drops the login that is already open", () => {
    const servers = [saved("a", "magical.rocks", "Sebi"), saved("b", "voice.kumo.gg", "Sebi")];
    const live = [session("sess", "magical.rocks", "Sebi")];
    expect(hosts(quickConnectTargets(groupSavedServers(servers, live), live))).toEqual(["voice.kumo.gg"]);
  });

  it("still offers a server's other identity while one of them is open", () => {
    // The backend keys a tab on host, port AND username, so arriving as the
    // second identity opens a second tab rather than reusing the first.
    const servers = [saved("a", "magical.rocks", "Sebi"), saved("b", "magical.rocks", "ZewiWin")];
    const live = [session("sess", "magical.rocks", "Sebi")];
    const targets = quickConnectTargets(groupSavedServers(servers, live), live);
    expect(targets).toHaveLength(1);
    expect(targets[0].group.host).toBe("magical.rocks");
    expect(targets[0].identity.username).toBe("ZewiWin");
  });

  it("drops a server only once every one of its identities is open", () => {
    const servers = [saved("a", "magical.rocks", "Sebi"), saved("b", "magical.rocks", "ZewiWin")];
    const live = [session("s1", "magical.rocks", "Sebi"), session("s2", "magical.rocks", "ZewiWin")];
    expect(quickConnectTargets(groupSavedServers(servers, live), live)).toEqual([]);
  });

  it("offers a login again once its session has disconnected", () => {
    // Nebula shows a tab only while it is connected, so a disconnected slot is
    // invisible: hiding its login too would leave no way back into the server.
    const servers = [saved("a", "magical.rocks", "Sebi")];
    const stale = [session("sess", "magical.rocks", "Sebi", "disconnected")];
    expect(hosts(quickConnectTargets(groupSavedServers(servers, stale), stale))).toEqual(["magical.rocks"]);
  });

  it("matches the open login case-insensitively on host but not on username", () => {
    const servers = [saved("a", "Magical.Rocks", "Sebi"), saved("b", "other.example", "sebi")];
    const live = [session("sess", "magical.rocks", "Sebi"), session("s2", "other.example", "Sebi")];
    // Same address in different case is the same server; "sebi" and "Sebi" are
    // different Mumble logins and get their own tabs.
    expect(hosts(quickConnectTargets(groupSavedServers(servers, live), live))).toEqual(["other.example"]);
  });

  it("offers the most recently joined login first", () => {
    const groups = groupSavedServers([
      saved("a", "aaa.example", "Sebi", { last_joined: 1000 }),
      saved("b", "zzz.example", "Sebi", { last_joined: 5000 }),
      saved("c", "mmm.example", "Sebi", { last_joined: 3000 }),
    ]);
    expect(hosts(quickConnectTargets(groups))).toEqual(["zzz.example", "mmm.example", "aaa.example"]);
  });

  it("ranks a server by the login it is about to use, not by its busiest one", () => {
    // The recent identity is open, so the row is about the older one and sorts
    // where that one belongs.
    const servers = [
      saved("a", "two.example", "Recent", { last_joined: 9000 }),
      saved("b", "two.example", "Stale", { last_joined: 100 }),
      saved("c", "one.example", "Solo", { last_joined: 2000 }),
    ];
    const live = [session("sess", "two.example", "Recent")];
    expect(hosts(quickConnectTargets(groupSavedServers(servers, live), live))).toEqual([
      "one.example",
      "two.example",
    ]);
  });

  it("sinks never-joined servers below joined ones, favourites first", () => {
    const groups = groupSavedServers([
      saved("a", "never-b.example", "Sebi"),
      saved("b", "never-a.example", "Sebi", { favorite: true }),
      saved("c", "joined.example", "Sebi", { last_joined: 10 }),
    ]);
    expect(hosts(quickConnectTargets(groups))).toEqual([
      "joined.example",
      "never-a.example",
      "never-b.example",
    ]);
  });

  it("arrives as the identity the address was last used with", () => {
    const [group] = groupSavedServers([
      saved("a", "magical.rocks", "Sebi", { favorite: true }),
      saved("b", "magical.rocks", "Zewi", { last_joined: 4000 }),
    ]);
    expect(preferredIdentity(group.identities)?.username).toBe("Zewi");
  });

  it("falls back to the favourite identity on an address never joined", () => {
    const [group] = groupSavedServers([
      saved("a", "magical.rocks", "Aaa"),
      saved("b", "magical.rocks", "Zzz", { favorite: true }),
    ]);
    expect(preferredIdentity(group.identities)?.username).toBe("Zzz");
  });

  it("has no identity to prefer out of an empty list", () => {
    expect(preferredIdentity([])).toBeNull();
  });
});

describe("formatLastJoined", () => {
  const noon = new Date(2026, 7, 22, 12, 0, 0).getTime();
  const day = 86_400_000;

  it("has nothing to say about a server that was never joined", () => {
    expect(formatLastJoined(null, noon)).toBeNull();
  });

  it("names the day for anything inside the last week", () => {
    expect(formatLastJoined(noon - 60_000, noon)).toBe("today");
    expect(formatLastJoined(noon - day, noon)).toBe("yesterday");
    expect(formatLastJoined(noon - 3 * day, noon)).toBe(
      new Date(noon - 3 * day).toLocaleDateString(undefined, { weekday: "short" }),
    );
  });

  it("falls back to a date once the weekday would be ambiguous", () => {
    expect(formatLastJoined(noon - 9 * day, noon)).toBe(
      new Date(noon - 9 * day).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    );
  });

  it("counts calendar days, not elapsed hours", () => {
    // 23:50 yesterday is "yesterday" at 00:10 today, an hour and a half later.
    const justAfterMidnight = new Date(2026, 7, 22, 0, 10, 0).getTime();
    const lateLastNight = new Date(2026, 7, 21, 23, 50, 0).getTime();
    expect(formatLastJoined(lateLastNight, justAfterMidnight)).toBe("yesterday");
  });
});

describe("quickSwitchTargets", () => {
  const channels = [channel({ id: 0, name: "Root" }), channel({ id: 1, name: "Gaming", user_count: 2 })];
  const users = [user(7, "ZewiWin", 1), user(8, "Ada", 1)];
  const sessions = [
    { id: "sess", host: "magical.rocks", port: 64738, username: "ZewiWin", label: "magical.rocks" },
    {
      id: "husk",
      host: "old.example",
      port: 64738,
      username: "ZewiWin",
      status: "disconnected" as ConnectionStatus,
    },
  ];
  const input = { channels, users, sessions, ownSession: 7, query: "" };

  it("offers channels, then people, then the servers that are open", () => {
    expect(quickSwitchTargets({ ...input, t }).map((target) => [target.kind, target.label])).toEqual([
      ["channel", "Root"],
      ["channel", "Gaming"],
      ["person", "Ada"],
      ["server", "magical.rocks"],
    ]);
  });

  it("matches the detail line as well as the name", () => {
    // The address is not in any label, so finding a server by it proves the
    // detail line is searched too.
    expect(quickSwitchTargets({ ...input, t, query: "magical.rocks:64738" })).toHaveLength(1);
    expect(quickSwitchTargets({ ...input, t, query: "gam" }).map((target) => target.label)).toEqual([
      "Gaming",
    ]);
  });

  it("keeps the list short enough to scan", () => {
    const many = Array.from({ length: 40 }, (_, index) => channel({ id: index + 2 }));
    expect(quickSwitchTargets({ ...input, t, channels: many, limit: 5 })).toHaveLength(5);
  });
});

describe("globalSearchRows", () => {
  const channels = [channel({ id: 0, name: "Root" }), channel({ id: 1, name: "Gaming", user_count: 3 })];
  const users = [user(7, "ZewiWin", 1), user(8, "Ada", 1)];
  const sessions = [
    { id: "sess", host: "magical.rocks", port: 64738, username: "ZewiWin", label: "magical.rocks" },
  ];
  const input = {
    results: [],
    channels,
    users,
    sessions,
    ownSession: 7,
    serverLabel: "magical.rocks",
    query: "",
  };

  function messageResult(partial: Partial<SearchResult["message"]> & { sender_name: string }) {
    return {
      category: "message" as const,
      score: 0,
      title: "queue is up - who's game for ranked?",
      subtitle: `${partial.sender_name} in #Gaming`,
      id: 1,
      string_id: "m-1",
      message: { context: "in #Gaming", ...partial },
    };
  }

  it("rests on somewhere to go before anything is typed", () => {
    expect(globalSearchRows({ ...input, t }).map((row) => [row.kind, row.title])).toEqual([
      ["channel", "Root"],
      ["channel", "Gaming"],
      ["person", "Ada"],
      ["server", "magical.rocks"],
    ]);
  });

  it("says how busy a channel is and which server it is on", () => {
    const gaming = globalSearchRows({ ...input, t, query: "gam" })[0];
    expect(gaming).toMatchObject({ kind: "channel", meta: "3 people here", subtitle: "magical.rocks" });
  });

  it("counts one occupant as a person, not as people", () => {
    const rows = globalSearchRows({
      t,
      ...input,
      channels: [channel({ id: 1, name: "Gaming", user_count: 1 })],
      query: "gam",
    });
    expect(rows[0]?.meta).toBe("1 person here");
  });

  it("places someone still on the roster in voice, and anyone else in a message", () => {
    const [present] = globalSearchRows({ ...input, t, query: "Ada" });
    expect(present).toMatchObject({ subtitle: "in voice · # Gaming", online: true, opens: "person" });

    // A message from someone who has since left still names them, but there is
    // no seat to send the reader to.
    const departed = globalSearchRows({
      t,
      ...input,
      users: [user(7, "ZewiWin", 1)],
      results: [{ category: "user", score: 0, title: "Ada", subtitle: null, id: 8, string_id: null }],
      query: "Ada",
    });
    expect(departed[0]).toMatchObject({ subtitle: "Direct message", online: false });
  });

  it("keeps matching locally while the backend has answered with nothing", () => {
    // The backend is a debounce and an IPC round trip behind the keystroke; a
    // channel the window already knows about must not disappear in the gap.
    expect(globalSearchRows({ ...input, t, query: "Gaming", results: [] }).map((row) => row.title)).toEqual([
      "Gaming",
    ]);
  });

  it("does not list a channel twice when both sources find it", () => {
    const rows = globalSearchRows({
      t,
      ...input,
      query: "Gaming",
      results: [{ category: "channel", score: 0, title: "Gaming", subtitle: null, id: 1, string_id: null }],
    });
    expect(rows.filter((row) => row.kind === "channel")).toHaveLength(1);
  });

  it("lays a message out as its sender, its place and its time", () => {
    const rows = globalSearchRows({
      t,
      ...input,
      query: "game",
      results: [messageResult({ sender_name: "enot", sender_session: 8, timestamp: 1_787_403_060_000 })],
    });
    const message = rows.find((row) => row.kind === "message");
    expect(message).toMatchObject({
      title: "enot",
      context: "in #Gaming",
      subtitle: "queue is up - who's game for ranked?",
      opens: "channel",
    });
    expect(message?.meta).toMatch(/\d{2}:\d{2}/);
    expect(message?.avatar).toMatchObject({ name: "enot", session: 8 });
  });

  it("sends a direct message to the conversation, not to the channel that shares its number", () => {
    const rows = globalSearchRows({
      t,
      ...input,
      query: "game",
      results: [messageResult({ sender_name: "enot", sender_session: 8, dm: true })],
    });
    expect(rows.find((row) => row.kind === "message")).toMatchObject({ opens: "person", id: 1 });
  });

  it("heads the group that matched best, not a fixed running order", () => {
    // A message that says exactly what was typed is what was being looked for;
    // a channel that merely contains those letters must not bury it.
    const rows = globalSearchRows({
      t,
      ...input,
      channels: [channel({ id: 1, name: "latest testing protocols" })],
      query: "test",
      results: [{ ...messageResult({ sender_name: "enot", sender_session: 8 }), title: "test", score: 0 }],
    });
    expect(rows[0]).toMatchObject({ kind: "message", subtitle: "test" });
    expect(rows.some((row) => row.kind === "channel")).toBe(true);
  });

  it("ranks inside a group by the match as well", () => {
    const rows = globalSearchRows({
      t,
      ...input,
      channels: [channel({ id: 1, name: "Gaming and other pastimes" }), channel({ id: 2, name: "Gaming" })],
      query: "Gaming",
    });
    expect(rows.filter((row) => row.kind === "channel").map((row) => row.title)).toEqual([
      "Gaming",
      "Gaming and other pastimes",
    ]);
  });

  it("keeps the canonical order while nothing has been typed", () => {
    expect([...new Set(globalSearchRows({ ...input, t }).map((row) => row.kind))]).toEqual([
      "channel",
      "person",
      "server",
    ]);
  });

  it("caps each group so the later ones are on the panel at all", () => {
    // The bug this guards: a server with dozens of channels filled the list
    // with them, and the people and messages never appeared. More channels
    // here than the local matcher's own cap, which was where they were lost.
    const many = Array.from({ length: 60 }, (_, index) => channel({ id: index + 1 }));
    const rows = globalSearchRows({ ...input, t, channels: many });
    expect(rows.filter((row) => row.kind === "channel")).toHaveLength(6);
    expect(rows.some((row) => row.kind === "person")).toBe(true);
    expect(rows.some((row) => row.kind === "server")).toBe(true);
  });
});

describe("messageContent", () => {
  it("reads a plain body as text", () => {
    expect(messageContent("<p>hello</p>")).toEqual({ kind: "text", quoteIds: [], html: "<p>hello</p>" });
  });

  it("lifts a poll marker out and keeps its id", () => {
    const content = messageContent("<!-- FANCY_POLL:abc-123 -->");
    expect(content).toEqual({ kind: "poll", pollId: "abc-123", quoteIds: [], html: "" });
  });

  it("lifts a file marker out and keeps the caption above it", () => {
    const content = messageContent("look at this <!-- FANCY_FILE:QUJD -->");
    expect(content).toEqual({ kind: "file", payloads: ["QUJD"], quoteIds: [], html: "look at this" });
  });

  it("formats a body that arrived as plain markdown", () => {
    // A bot or a legacy client sends what it typed. Handed to the DOM as it
    // stands, the asterisks are the message - which is what the chat river
    // was printing for every bot line in it.
    const content = messageContent("**Nice settings** _channel fox_ `code 2994`");
    expect(content.html).toBe("<b>Nice settings</b> <i>channel fox</i> <code>code 2994</code>");
  });

  it("formats the caption sent beside an attachment", () => {
    // The marker comes off first, so what is left is plain text again.
    const content = messageContent("**look** at this <!-- FANCY_FILE:QUJD -->");
    expect(content.html).toBe("<b>look</b> at this");
  });

  it("prefers a poll over a file when a body somehow carries both", () => {
    expect(messageContent("<!-- FANCY_FILE:QUJD --><!-- FANCY_POLL:p1 -->").kind).toBe("poll");
  });

  it("collects every quote marker and leaves the reply behind", () => {
    const content = messageContent("<!-- FANCY_QUOTE:m1 --><!-- FANCY_QUOTE:m2 -->agreed");
    expect(content).toEqual({ kind: "text", quoteIds: ["m1", "m2"], html: "agreed" });
  });

  it("reads a quoted attachment as both", () => {
    const content = messageContent("<!-- FANCY_QUOTE:m1 -->here <!-- FANCY_FILE:QUJD -->");
    expect(content).toEqual({ kind: "file", payloads: ["QUJD"], quoteIds: ["m1"], html: "here" });
  });

  it("reads every attachment in a batch, in the order they were sent", () => {
    // A batch staged together is one message with a marker each; reading only
    // the first drew one picture and dropped the rest on the floor.
    const content = messageContent("the ferry ones<!-- FANCY_FILE:QUJD --><!-- FANCY_FILE:REVG -->");

    expect(content).toEqual({
      kind: "file",
      payloads: ["QUJD", "REVG"],
      quoteIds: [],
      html: "the ferry ones",
    });
  });
});

describe("composerHtml and editableText", () => {
  it("round-trips typed text through the wire format", () => {
    const typed = "a < b & c\nsecond line";
    expect(editableText(composerHtml(typed))).toBe(typed);
  });

  it("does not double-unescape an entity the author typed", () => {
    expect(editableText(composerHtml("&amp;lt;"))).toBe("&amp;lt;");
  });

  it("turns every break variant back into a newline", () => {
    expect(editableText("one<br>two<br />three")).toBe("one\ntwo\nthree");
  });
});

describe("serverRailEntries", () => {
  const saved = (id: string, host: string, username: string) =>
    ({ id, label: host, host, port: 64738, username, cert_label: null, favorite: false }) as never;
  const sess = (id: string, host: string, status: ConnectionStatus) => ({
    id,
    host,
    port: 64738,
    username: "Sebi",
    status,
  });

  it("gives a saved server a tile even when nobody is connected to it", () => {
    const entries = serverRailEntries(groupSavedServers([saved("a", "magical.rocks", "Sebi")]));
    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe("saved");
    expect(entries[0].unread).toBe(0);
  });

  it("tells a connecting server apart from a connected one", () => {
    const servers = [saved("a", "magical.rocks", "Sebi"), saved("b", "voice.kumo.gg", "Sebi")];
    const sessions = [sess("s1", "magical.rocks", "connected"), sess("s2", "voice.kumo.gg", "connecting")];
    const entries = serverRailEntries(groupSavedServers(servers, sessions), sessions);
    expect(entries.map((entry) => entry.status)).toEqual(["connected", "connecting"]);
  });

  it("counts unread against the session, so a server nobody is on has none", () => {
    const servers = [saved("a", "magical.rocks", "Sebi"), saved("b", "voice.kumo.gg", "Sebi")];
    const sessions = [sess("s1", "magical.rocks", "connected")];
    const entries = serverRailEntries(groupSavedServers(servers, sessions), sessions, { s1: 12, s2: 99 });
    expect(entries.map((entry) => entry.unread)).toEqual([12, 0]);
  });

  it("keeps a tile for a live session that was never saved", () => {
    // Quick connect can open an address that is not in the saved list, and the
    // rail is the only way back to that tab.
    const sessions = [sess("s1", "one-off.example", "connected")];
    const entries = serverRailEntries([], sessions);
    expect(entries.map((entry) => entry.group.label)).toEqual(["one-off.example"]);
    expect(entries[0].session?.id).toBe("s1");
  });

  it("follows the stored order and appends anything it does not name", () => {
    const servers = [
      saved("a", "aaa.example", "Sebi"),
      saved("b", "bbb.example", "Sebi"),
      saved("c", "ccc.example", "Sebi"),
    ];
    const entries = serverRailEntries(groupSavedServers(servers), [], {}, [
      "ccc.example:64738",
      "aaa.example:64738",
    ]);
    expect(entries.map((entry) => entry.group.host)).toEqual(["ccc.example", "aaa.example", "bbb.example"]);
  });
});

describe("reorderServerRail", () => {
  const rail = (...hosts: string[]) =>
    hosts.map((host) => ({ group: { key: host } })) as never as Parameters<typeof reorderServerRail>[0];

  it("drops a tile in front of the one it was released over", () => {
    expect(reorderServerRail(rail("a", "b", "c"), "c", "a")).toEqual(["c", "a", "b"]);
  });

  it("drops a tile at the end when it was released past the last one", () => {
    expect(reorderServerRail(rail("a", "b", "c"), "a", null)).toEqual(["b", "c", "a"]);
  });

  it("leaves the order alone when the tile is dropped on itself", () => {
    expect(reorderServerRail(rail("a", "b", "c"), "b", "b")).toEqual(["a", "b", "c"]);
  });

  it("returns the order unchanged when the moved tile is not on the rail", () => {
    // A tile can leave the rail mid-drag - the server it stood for was removed
    // in another window - and the drop must not invent an entry for it.
    expect(reorderServerRail(rail("a", "b"), "gone", "a")).toEqual(["a", "b"]);
  });
});

describe("splitBodyImages", () => {
  it("lifts the pictures out and leaves the prose behind", () => {
    const { html, images } = splitBodyImages(
      '<p>the ferry ones</p><img src="a.jpg" alt="ferry"><img src="b.jpg" alt="skyline">',
    );

    expect(html).toBe("<p>the ferry ones</p>");
    expect(images).toEqual([
      { src: "a.jpg", alt: "ferry" },
      { src: "b.jpg", alt: "skyline" },
    ]);
  });

  it("hands back the src exactly as written", () => {
    // The lightbox's gallery is keyed by the attribute, not by the absolute
    // URL a browser resolves it to - a bare host comes back with a slash.
    const { images } = splitBodyImages('<img src="https://example.com">');

    expect(images[0]?.src).toBe("https://example.com");
  });

  it("leaves a body with no pictures untouched", () => {
    const body = "<p>just words</p>";

    expect(splitBodyImages(body)).toEqual({ html: body, images: [] });
  });

  it("drops a picture with no source rather than tiling a broken one", () => {
    const { html, images } = splitBodyImages('<img alt="nothing"><p>text</p>');

    expect(images).toEqual([]);
    expect(html).toBe("<p>text</p>");
  });
});
