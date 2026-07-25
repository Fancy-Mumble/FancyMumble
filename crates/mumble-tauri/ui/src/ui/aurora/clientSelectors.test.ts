import { describe, expect, it } from "vitest";
import {
  filterChannelMessages,
  filterDmMessages,
  filterVisibleChannels,
  groupServersForRail,
  listChannelMembers,
  matchesChatQuery,
  senderRelationKey,
} from "./clientSelectors";
import type { RailSession } from "./clientSelectors";
import type { ChannelEntry, RegisteredUser, SavedServer, UserEntry } from "@core/types";

const channel = (over: Partial<ChannelEntry> & { id: number; name: string }) => ({
  parent_id: null, position: 0, user_count: 0, detached: false, ...over,
}) as ChannelEntry;

const user = (over: Partial<UserEntry> & { session: number; name: string }) => ({
  channel_id: 0, user_id: null, ...over,
}) as UserEntry;

const message = (over: { sender_name: string; body?: string; sender_hash?: string | null; channel_id?: number | null; dm_session?: number | null }) => ({
  body: "<p>hello</p>", sender_hash: null, channel_id: 1, dm_session: null, ...over,
});

describe("senderRelationKey", () => {
  it("prefers the certificate hash over the display name", () => {
    expect(senderRelationKey({ sender_hash: "abc", sender_name: "Morgan", body: "" })).toBe("hash:abc");
  });

  it("falls back to a lowercased name so casing cannot dodge a relation", () => {
    expect(senderRelationKey({ sender_hash: null, sender_name: "MoRgAn", body: "" })).toBe("name:morgan");
  });
});

describe("matchesChatQuery", () => {
  it("matches rendered text, not the HTML source", () => {
    const m = { sender_name: "a", body: '<a href="https://example.com/secret">click</a>' };
    expect(matchesChatQuery(m, "click")).toBe(true);
    // "secret" only exists in the markup, so it must not match
    expect(matchesChatQuery(m, "secret")).toBe(false);
  });

  it("treats a blank query as matching everything", () => {
    expect(matchesChatQuery({ sender_name: "a", body: "<p>x</p>" }, "   ")).toBe(true);
  });
});

describe("filterVisibleChannels", () => {
  const channels = [
    channel({ id: 0, name: "Root" }),
    channel({ id: 1, name: "design", parent_id: 0, user_count: 2 }),
    channel({ id: 2, name: "empty", parent_id: 0, user_count: 0 }),
    channel({ id: 3, name: "gone", parent_id: 0, detached: true }),
  ];

  it("keeps ancestors of a match so the tree stays reachable", () => {
    const out = filterVisibleChannels({ channels, query: "design", hideEmpty: false, currentChannel: null, selectedChannel: null });
    expect(out.map((c) => c.id).sort()).toEqual([0, 1]);
  });

  it("drops detached channels", () => {
    const out = filterVisibleChannels({ channels, query: "", hideEmpty: false, currentChannel: null, selectedChannel: null });
    expect(out.map((c) => c.id)).not.toContain(3);
  });

  it("keeps an empty channel when it is the selected one", () => {
    const out = filterVisibleChannels({ channels, query: "", hideEmpty: true, currentChannel: null, selectedChannel: 2 });
    expect(out.map((c) => c.id)).toContain(2);
  });

  it("hides empty channels otherwise", () => {
    const out = filterVisibleChannels({ channels, query: "", hideEmpty: true, currentChannel: null, selectedChannel: null });
    expect(out.map((c) => c.id)).not.toContain(2);
  });
});

describe("listChannelMembers", () => {
  const users = [
    user({ session: 1, name: "Zoe", channel_id: 1, user_id: 10 }),
    user({ session: 2, name: "Alex", channel_id: 1, user_id: 11 }),
    user({ session: 3, name: "Sam", channel_id: 2, user_id: 12 }),
  ];
  const registered = [
    { user_id: 11, name: "Alex", last_channel: 1 },
    { user_id: 99, name: "Offline Pat", last_channel: 1 },
  ] as RegisteredUser[];

  it("scopes to the selected channel", () => {
    const out = listChannelMembers({ users, registeredUsers: [], scope: "channel", query: "", selectedChannel: 1, talkingSessions: new Set() });
    expect(out.map((u) => u.name)).toEqual(["Alex", "Zoe"]);
  });

  it("sorts talkers ahead of the rest", () => {
    const out = listChannelMembers({ users, registeredUsers: [], scope: "channel", query: "", selectedChannel: 1, talkingSessions: new Set([1]) });
    expect(out[0].name).toBe("Zoe");
  });

  it("adds offline registered users last in server scope, skipping ones already online", () => {
    const out = listChannelMembers({ users, registeredUsers: registered, scope: "server", query: "", selectedChannel: 1, talkingSessions: new Set() });
    expect(out.at(-1)!.name).toBe("Offline Pat");
    expect(out.filter((u) => u.name === "Alex")).toHaveLength(1);
  });
});

describe("filterChannelMessages", () => {
  const relations = { "name:spammer": { ignored: true } };

  it("drops other channels, DMs, and ignored senders", () => {
    const out = filterChannelMessages({
      messages: [
        message({ sender_name: "Ok" }),
        message({ sender_name: "Elsewhere", channel_id: 7 }),
        message({ sender_name: "Dm", dm_session: 4 }),
        message({ sender_name: "Spammer" }),
      ],
      pollMessages: [],
      selectedChannel: 1,
      relations,
      query: "",
    });
    expect(out.map((m) => m.sender_name)).toEqual(["Ok"]);
  });

  it("merges poll messages in", () => {
    const out = filterChannelMessages({
      messages: [message({ sender_name: "A" })],
      pollMessages: [message({ sender_name: "Poll" })],
      selectedChannel: 1, relations: {}, query: "",
    });
    expect(out).toHaveLength(2);
  });
});

describe("filterDmMessages", () => {
  it("returns nothing at all when the peer is blocked", () => {
    const out = filterDmMessages({
      dmMessages: [message({ sender_name: "A" })], blocked: true, relations: {}, query: "",
    });
    expect(out).toEqual([]);
  });

  it("still applies the ignore list and the search query when not blocked", () => {
    const out = filterDmMessages({
      dmMessages: [
        message({ sender_name: "A", body: "<p>keep this</p>" }),
        message({ sender_name: "A", body: "<p>drop</p>" }),
      ],
      blocked: false, relations: {}, query: "keep",
    });
    expect(out).toHaveLength(1);
  });
});

describe("groupServersForRail", () => {
  const saved = [
    { id: "s1", label: "Studio", host: "a.example", port: 64738, username: "morgan", favorite: false },
    { id: "s2", label: "Studio", host: "a.example", port: 64738, username: "alt", favorite: false },
    { id: "s3", label: "Guild", host: "b.example", port: 64738, username: "alex", favorite: true },
  ] as SavedServer[];

  it("collapses identities on one address into a single tile", () => {
    const groups = groupServersForRail(saved, []);
    const studio = groups.find((g) => g.host === "a.example")!;
    expect(studio.identities).toHaveLength(2);
  });

  it("sorts favorites first", () => {
    expect(groupServersForRail(saved, [])[0].label).toBe("Guild");
  });

  it("links a live session to its saved identity", () => {
    const sessions: RailSession[] = [{ id: "live", host: "a.example", port: 64738, username: "morgan", label: "Studio" }];
    const studio = groupServersForRail(saved, sessions).find((g) => g.host === "a.example")!;
    expect(studio.identities.find((i) => i.username === "morgan")!.sessionId).toBe("live");
  });

  it("gives a direct-connect session its own tile", () => {
    const sessions: RailSession[] = [{ id: "live", host: "c.example", port: 64738, username: "x", label: "Direct" }];
    expect(groupServersForRail(saved, sessions).some((g) => g.host === "c.example")).toBe(true);
  });
});
