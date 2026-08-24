import { describe, expect, it } from "vitest";
import { hexToHsl } from "@core/utils/colorUtils";
import type { ChannelEntry, ConnectionStatus, SearchResult, UserEntry } from "@core/types";
import {
  channelOccupants,
  composerHtml,
  editableText,
  messageContent,
  groupMessagesByDay,
  groupSavedServers,
  listDirectConversations,
  orderChannels,
  preferredIdentity,
  quickConnectTargets,
  quickSwitchTargets,
  globalSearchRows,
  formatLastJoined,
  serverTint,
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
  it("puts talkers first, then sorts by name", () => {
    const users = [user(1, "Zoe", 4), user(2, "Adam", 4), user(3, "Mia", 4), user(4, "Elsewhere", 5)];
    expect(channelOccupants(users, 4, new Set([3])).map((entry) => entry.name)).toEqual([
      "Mia",
      "Adam",
      "Zoe",
    ]);
  });
});

describe("groupMessagesByDay", () => {
  const now = new Date("2026-08-22T20:00:00Z");
  const at = (iso: string) => ({ timestamp: new Date(iso).getTime() });

  it("labels the current and previous day by name", () => {
    const sections = groupMessagesByDay([at("2026-08-21T10:00:00"), at("2026-08-22T10:00:00")], now);
    expect(sections.map((section) => section.label)).toEqual(["Yesterday", "Today"]);
  });

  it("keeps timestamp-less legacy messages in the open section", () => {
    const sections = groupMessagesByDay([at("2026-08-22T10:00:00"), { timestamp: null }], now);
    expect(sections).toHaveLength(1);
    expect(sections[0].messages).toHaveLength(2);
  });
});

describe("listDirectConversations", () => {
  it("floats unread threads above everything else", () => {
    const result = listDirectConversations({
      users: [user(1, "Adam"), user(2, "Zoe"), user(3, "Me")],
      ownSession: 3,
      history: new Map(),
      unreadCounts: { 2: 4 },
      query: "",
    });
    expect(result.map((entry) => entry.user.name)).toEqual(["Zoe", "Adam"]);
    expect(result[0].unread).toBe(4);
  });

  it("never lists the local user as a conversation partner", () => {
    const result = listDirectConversations({
      users: [user(1, "Adam"), user(3, "Me")],
      ownSession: 3,
      history: new Map(),
      unreadCounts: {},
      query: "",
    });
    expect(result.map((entry) => entry.user.session)).toEqual([1]);
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
    expect(quickSwitchTargets(input).map((target) => [target.kind, target.label])).toEqual([
      ["channel", "Root"],
      ["channel", "Gaming"],
      ["person", "Ada"],
      ["server", "magical.rocks"],
    ]);
  });

  it("matches the detail line as well as the name", () => {
    // The address is not in any label, so finding a server by it proves the
    // detail line is searched too.
    expect(quickSwitchTargets({ ...input, query: "magical.rocks:64738" })).toHaveLength(1);
    expect(quickSwitchTargets({ ...input, query: "gam" }).map((target) => target.label)).toEqual(["Gaming"]);
  });

  it("keeps the list short enough to scan", () => {
    const many = Array.from({ length: 40 }, (_, index) => channel({ id: index + 2 }));
    expect(quickSwitchTargets({ ...input, channels: many, limit: 5 })).toHaveLength(5);
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
    expect(globalSearchRows(input).map((row) => [row.kind, row.title])).toEqual([
      ["channel", "Root"],
      ["channel", "Gaming"],
      ["person", "Ada"],
      ["server", "magical.rocks"],
    ]);
  });

  it("says how busy a channel is and which server it is on", () => {
    const gaming = globalSearchRows({ ...input, query: "gam" })[0];
    expect(gaming).toMatchObject({ kind: "channel", meta: "3 people here", subtitle: "magical.rocks" });
  });

  it("counts one occupant as a person, not as people", () => {
    const rows = globalSearchRows({
      ...input,
      channels: [channel({ id: 1, name: "Gaming", user_count: 1 })],
      query: "gam",
    });
    expect(rows[0]?.meta).toBe("1 person here");
  });

  it("places someone still on the roster in voice, and anyone else in a message", () => {
    const [present] = globalSearchRows({ ...input, query: "Ada" });
    expect(present).toMatchObject({ subtitle: "in voice · # Gaming", online: true, opens: "person" });

    // A message from someone who has since left still names them, but there is
    // no seat to send the reader to.
    const departed = globalSearchRows({
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
    expect(globalSearchRows({ ...input, query: "Gaming", results: [] }).map((row) => row.title)).toEqual([
      "Gaming",
    ]);
  });

  it("does not list a channel twice when both sources find it", () => {
    const rows = globalSearchRows({
      ...input,
      query: "Gaming",
      results: [{ category: "channel", score: 0, title: "Gaming", subtitle: null, id: 1, string_id: null }],
    });
    expect(rows.filter((row) => row.kind === "channel")).toHaveLength(1);
  });

  it("lays a message out as its sender, its place and its time", () => {
    const rows = globalSearchRows({
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
    expect([...new Set(globalSearchRows(input).map((row) => row.kind))]).toEqual([
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
    const rows = globalSearchRows({ ...input, channels: many });
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
    expect(content).toEqual({ kind: "file", payload: "QUJD", quoteIds: [], html: "look at this" });
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
    expect(content).toEqual({ kind: "file", payload: "QUJD", quoteIds: ["m1"], html: "here" });
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
