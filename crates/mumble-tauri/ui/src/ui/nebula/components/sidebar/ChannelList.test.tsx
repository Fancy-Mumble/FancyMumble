import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelEntry, UserEntry } from "@core/types";
import { withNebulaTheme } from "../../testTheme";
import { ChannelList } from "./ChannelList";
import type { NebulaChannelViewer } from "../../useChannelViewer";

vi.mock("@core/lazyBlobs", () => ({ useUserAvatar: () => null, useChannelDescription: () => null }));

// The layout the list is drawn in, without going through the personalization
// store to say so.
let viewer: NebulaChannelViewer = "flat";
vi.mock("../../useChannelViewer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../useChannelViewer")>()),
  useChannelViewer: () => viewer,
}));

beforeEach(() => {
  viewer = "flat";
});

const channel = (id: number, name: string, extra: Partial<ChannelEntry> = {}): ChannelEntry =>
  ({
    id,
    name,
    parent_id: 0,
    position: 0,
    user_count: 1,
    permissions: null,
    attributes: 0,
    is_enter_restricted: false,
    ...extra,
  }) as unknown as ChannelEntry;

const member = (session: number, name: string, state: Partial<UserEntry> = {}): UserEntry =>
  ({
    session,
    name,
    channel_id: 2,
    texture_size: null,
    mute: false,
    deaf: false,
    suppress: false,
    self_mute: false,
    self_deaf: false,
    priority_speaker: false,
    ...state,
  }) as UserEntry;

function show(users: UserEntry[], ownSession = 9, currentChannel: number | null = 2) {
  render(
    withNebulaTheme(
      <ChannelList
        channels={[
          { channel: channel(2, "Gaming"), depth: 0 },
          { channel: channel(3, "Lounge"), depth: 0 },
        ]}
        users={users}
        selectedChannel={2}
        currentChannel={currentChannel}
        talkingSessions={new Set()}
        unreadCounts={{}}
        ownSession={ownSession}
        onSelect={vi.fn()}
        onJoin={vi.fn()}
        onContextMenu={vi.fn()}
        onSelectUser={vi.fn()}
        onHoverUser={vi.fn()}
        onLeaveUser={vi.fn()}
      />,
    ),
  );
}

describe("ChannelList speaker states", () => {
  it("badges a priority speaker", () => {
    show([member(1, "Sebi", { priority_speaker: true })]);
    expect(screen.getByLabelText("Priority speaker")).toBeTruthy();
  });

  it("separates a server mute from a self mute", () => {
    show([member(1, "Jonas", { mute: true, deaf: true }), member(2, "ZewiWin", { self_mute: true })]);
    expect(screen.getByLabelText("Server muted")).toBeTruthy();
    expect(screen.getByLabelText("Server deafened")).toBeTruthy();
    expect(screen.getByLabelText("Self muted")).toBeTruthy();
  });

  it("reads a suppressed user as server muted", () => {
    show([member(1, "Jonas", { suppress: true })]);
    expect(screen.getByLabelText("Server muted")).toBeTruthy();
  });

  it("shows only the badge the user cannot lift when both are set", () => {
    show([member(1, "Jonas", { mute: true, self_mute: true })]);
    expect(screen.getByLabelText("Server muted")).toBeTruthy();
    expect(screen.queryByLabelText("Self muted")).toBeNull();
  });

  it("leaves a plain member unbadged", () => {
    show([member(1, "enot")]);
    expect(screen.queryByLabelText(/muted|deafened|Priority/i)).toBeNull();
  });

  it("badges your own row too, leaving the 'you' marker at the edge", () => {
    show([member(9, "ZewiWin", { self_deaf: true, self_mute: true })], 9);
    expect(screen.getByText("you")).toBeTruthy();
    expect(screen.getByLabelText("Self muted")).toBeTruthy();
    expect(screen.getByLabelText("Self deafened")).toBeTruthy();
  });
});

describe("ChannelList occupants", () => {
  it("lists members of channels you are not in", () => {
    show([member(1, "enot", { channel_id: 3 })], 9, 2);
    expect(screen.getByText("enot")).toBeTruthy();
  });

  it("badges those members the same way", () => {
    show([member(1, "enot", { channel_id: 3, mute: true })], 9, 2);
    expect(screen.getByLabelText("Server muted")).toBeTruthy();
  });

  it("still lists members when you are in no channel at all", () => {
    show([member(1, "enot", { channel_id: 3 }), member(2, "Sebi", { channel_id: 2 })], 9, null);
    expect(screen.getByText("enot")).toBeTruthy();
    expect(screen.getByText("Sebi")).toBeTruthy();
  });
});

/** A tree with one branch: Gaming, and Ranked nested under it. */
function showTree(privateRooms: ChannelEntry[] = []) {
  const parent = channel(2, "Gaming");
  const child = { ...channel(4, "Ranked"), parent_id: 2 } as ChannelEntry;
  render(
    withNebulaTheme(
      <ChannelList
        channels={[
          { channel: parent, depth: 0 },
          { channel: child, depth: 1 },
          { channel: channel(3, "Lounge"), depth: 0 },
        ]}
        users={[member(1, "enot", { channel_id: 2 })]}
        selectedChannel={2}
        currentChannel={null}
        talkingSessions={new Set()}
        unreadCounts={{}}
        ownSession={9}
        privateRooms={privateRooms}
        onSelect={vi.fn()}
        onJoin={vi.fn()}
        onContextMenu={vi.fn()}
        onSelectUser={vi.fn()}
        onHoverUser={vi.fn()}
        onLeaveUser={vi.fn()}
      />,
    ),
  );
}

describe("ChannelList private rooms", () => {
  it("lists the detached rooms the tree leaves out", () => {
    showTree([channel(7, "Standup")]);
    expect(screen.getByText("Private rooms")).toBeTruthy();
    expect(screen.getByText("Standup")).toBeTruthy();
  });

  it("leaves both lists unlabelled when there are none", () => {
    // One list needs no heading, so a server without meeting rooms looks
    // exactly as it did before the section existed.
    showTree();
    expect(screen.queryByText("Private rooms")).toBeNull();
    expect(screen.queryByText("Channels")).toBeNull();
  });

  it("draws every channel, nested ones included", () => {
    showTree([channel(7, "Standup")]);
    expect(screen.getByText("Gaming")).toBeTruthy();
    expect(screen.getByText("Ranked")).toBeTruthy();
    expect(screen.getByText("Lounge")).toBeTruthy();
  });
});

describe("ChannelList viewer style", () => {
  it("names the occupants in the flat layout", () => {
    showTree();
    expect(screen.getByText("enot")).toBeTruthy();
  });

  it("shows them as faces instead in the modern one", () => {
    viewer = "modern";
    showTree();
    expect(screen.queryByText("enot")).toBeNull();
    expect(screen.getByLabelText("enot")).toBeTruthy();
  });
});

/** Two rooms whose persistence protocols differ, plus one that keeps nothing. */
function showProtocols() {
  render(
    withNebulaTheme(
      <ChannelList
        channels={[
          { channel: channel(2, "Archive", { pchat_protocol: "fancy_v1_full_archive" }), depth: 0 },
          { channel: channel(3, "Private", { pchat_protocol: "signal_v1" }), depth: 0 },
          { channel: channel(4, "Lobby", { pchat_protocol: "none" }), depth: 0 },
        ]}
        users={[]}
        selectedChannel={2}
        currentChannel={null}
        talkingSessions={new Set()}
        unreadCounts={{}}
        ownSession={9}
        onSelect={vi.fn()}
        onJoin={vi.fn()}
        onContextMenu={vi.fn()}
        onSelectUser={vi.fn()}
        onHoverUser={vi.fn()}
        onLeaveUser={vi.fn()}
      />,
    ),
  );
}

describe("ChannelList persistence badge", () => {
  it("names the protocol a room keeps its history under", () => {
    showProtocols();
    expect(screen.getByText("Fancy")).toBeTruthy();
    expect(screen.getByText("Signal")).toBeTruthy();
  });

  it("puts the badge on the room it belongs to", () => {
    showProtocols();
    const rows = screen.getAllByTestId("channel-item");
    const badgeOf = (name: string) =>
      rows
        .find((row) => row.getAttribute("data-channel-name") === name)
        ?.querySelector("[data-pchat-protocol]")
        ?.getAttribute("data-pchat-protocol") ?? null;
    expect(badgeOf("Archive")).toBe("fancy_v1_full_archive");
    expect(badgeOf("Private")).toBe("signal_v1");
  });

  it("leaves a room that keeps nothing unbadged", () => {
    showProtocols();
    const lobby = screen
      .getAllByTestId("channel-item")
      .find((row) => row.getAttribute("data-channel-name") === "Lobby");
    expect(lobby?.querySelector("[data-pchat-protocol]")).toBeNull();
  });

  it("says the long form on hover, so the label need not carry it", () => {
    showProtocols();
    expect(screen.getByText("Fancy").getAttribute("title")).toBe("Fancy E2EE (full archive)");
    expect(screen.getByText("Signal").getAttribute("title")).toBe("Signal Protocol encryption");
  });
});
