import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelEntry, UserEntry } from "@core/types";
import { useAppStore } from "@core/store";
import { PERM_MOVE } from "@core/utils/permissions";
import { withNebulaTheme } from "../../testTheme";
import { ChannelList } from "./ChannelList";
import type { NebulaChannelViewer } from "../../useChannelViewer";

vi.mock("@core/lazyBlobs", () => ({ useUserAvatar: () => null, useChannelDescription: () => null }));

const invokeMock = vi.fn((..._args: unknown[]) => Promise.resolve());
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

// The layout the list is drawn in, without going through the personalization
// store to say so.
let viewer: NebulaChannelViewer = "flat";
vi.mock("../../useChannelViewer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../useChannelViewer")>()),
  useChannelViewer: () => viewer,
}));

beforeEach(() => {
  viewer = "flat";
  invokeMock.mockClear();
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

describe("carrying a user to another channel", () => {
  /** Two rooms, one moderator's worth of permission, and Ann sitting in one. */
  function showRooms() {
    render(
      withNebulaTheme(
        <ChannelList
          channels={[
            { channel: channel(2, "Gaming", { permissions: PERM_MOVE }), depth: 0 },
            { channel: channel(3, "Lounge"), depth: 0 },
          ]}
          users={[member(1, "Ann", { channel_id: 2 })]}
          selectedChannel={2}
          currentChannel={2}
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
    const row = document.querySelector('[data-user-name="Ann"]') as HTMLElement;
    const lounge = document
      .querySelector('[data-channel-name="Lounge"]')
      ?.closest("li") as HTMLElement;
    lounge.getBoundingClientRect = () =>
      ({ left: 0, top: 100, right: 200, bottom: 160, width: 200, height: 60 }) as DOMRect;
    return { row, lounge };
  }

  it("moves them to the room the drop landed on", () => {
    const { row } = showRooms();
    fireEvent.pointerDown(row, { clientX: 10, clientY: 10, pointerId: 1, button: 0 });
    fireEvent.pointerMove(row, { clientX: 10, clientY: 130, pointerId: 1 });
    fireEvent.pointerUp(row, { clientX: 10, clientY: 130, pointerId: 1 });

    expect(invokeMock).toHaveBeenCalledWith("move_user_to_channel", { session: 1, channelId: 3 });
  });

  it("asks for nothing when the drop lands on no room at all", () => {
    const { row } = showRooms();
    fireEvent.pointerDown(row, { clientX: 10, clientY: 10, pointerId: 1, button: 0 });
    fireEvent.pointerMove(row, { clientX: 10, clientY: 900, pointerId: 1 });
    fireEvent.pointerUp(row, { clientX: 10, clientY: 900, pointerId: 1 });

    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("leaves a press that never moved as a click on the user", () => {
    const { row } = showRooms();
    fireEvent.pointerDown(row, { clientX: 10, clientY: 10, pointerId: 1, button: 0 });
    fireEvent.pointerUp(row, { clientX: 11, clientY: 11, pointerId: 1 });

    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("will not carry somebody out of a room you may not move them from", () => {
    render(
      withNebulaTheme(
        <ChannelList
          channels={[
            { channel: channel(2, "Gaming"), depth: 0 },
            { channel: channel(3, "Lounge"), depth: 0 },
          ]}
          users={[member(1, "Ann", { channel_id: 2 })]}
          selectedChannel={2}
          currentChannel={2}
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
    const row = document.querySelector('[data-user-name="Ann"]') as HTMLElement;
    const lounge = document.querySelector('[data-channel-name="Lounge"]')?.closest("li") as HTMLElement;
    lounge.getBoundingClientRect = () =>
      ({ left: 0, top: 100, right: 200, bottom: 160, width: 200, height: 60 }) as DOMRect;

    fireEvent.pointerDown(row, { clientX: 10, clientY: 10, pointerId: 1, button: 0 });
    fireEvent.pointerMove(row, { clientX: 10, clientY: 130, pointerId: 1 });
    fireEvent.pointerUp(row, { clientX: 10, clientY: 130, pointerId: 1 });

    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe("ChannelList live badge", () => {
  const initial = useAppStore.getState();
  afterEach(() => {
    useAppStore.setState({ broadcastingSessions: initial.broadcastingSessions, serverConfig: initial.serverConfig });
  });

  it("marks a member sharing their screen, and says which route it takes", () => {
    useAppStore.setState({
      broadcastingSessions: new Set([4]),
      serverConfig: { ...initial.serverConfig, webrtc_sfu_available: true },
    });
    show([member(4, "Sharer"), member(5, "Watcher")]);
    const badges = document.querySelectorAll("[data-live-badge]");
    expect(badges).toHaveLength(1);
    expect(badges[0].getAttribute("data-live-badge")).toBe("relayed");
    expect(badges[0].textContent).toBe("Live");
    expect(badges[0].closest('[data-user-name="Sharer"]')).toBeTruthy();
  });

  it("says P2P where the server relays nothing", () => {
    useAppStore.setState({
      broadcastingSessions: new Set([4]),
      serverConfig: { ...initial.serverConfig, webrtc_sfu_available: false },
    });
    show([member(4, "Sharer")]);
    expect(document.querySelector("[data-live-badge]")?.textContent).toBe("P2P");
  });
});

describe("ChannelList arrange mode", () => {
  const tree = [
    { channel: channel(2, "Gaming"), depth: 0 },
    { channel: channel(3, "Lounge"), depth: 0 },
    { channel: channel(4, "Music"), depth: 0 },
  ];
  // jsdom lays nothing out, so each row answers with a 40px slot of its own.
  const slotOf = (element: Element) => {
    if (element.tagName === "UL") return { top: 0, bottom: 1000, left: 0, right: 200 };
    const id = Number(element.querySelector("[data-channel-id]")?.getAttribute("data-channel-id"));
    const index = tree.findIndex((entry) => entry.channel.id === id);
    return index === -1 ? null : { top: index * 40 + 100, bottom: index * 40 + 140, left: 10, right: 190 };
  };
  let frames: FrameRequestCallback[] = [];

  beforeEach(() => {
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
    vi.stubGlobal("cancelAnimationFrame", () => {});
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const slot = slotOf(this);
      return { x: 0, y: 0, width: 180, height: 40, toJSON: () => ({}), ...(slot ?? { top: 0, bottom: 0, left: 0, right: 0 }) } as DOMRect;
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function arrange(arranging: boolean, currentChannel: number | null = null) {
    const handlers = { onArrange: vi.fn(), onDoneArranging: vi.fn(), onSelect: vi.fn() };
    render(
      withNebulaTheme(
        <ChannelList
          channels={tree}
          users={[member(1, "enot", { channel_id: 3 })]}
          selectedChannel={currentChannel}
          currentChannel={currentChannel}
          talkingSessions={new Set()}
          unreadCounts={{}}
          ownSession={9}
          onJoin={vi.fn()}
          onContextMenu={vi.fn()}
          onSelectUser={vi.fn()}
          onHoverUser={vi.fn()}
          onLeaveUser={vi.fn()}
          arranging={arranging}
          {...handlers}
        />,
      ),
    );
    return handlers;
  }

  const row = (name: string) => document.querySelector(`[data-channel-name="${name}"]`) as HTMLElement;
  const pointer = (target: EventTarget, type: string, clientY: number) =>
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, clientY }));
  const flush = () => {
    const pending = frames;
    frames = [];
    act(() => pending.forEach((callback) => callback(0)));
  };

  it("swaps the occupants for a bar that leads back out", () => {
    const handlers = arrange(true);
    expect(screen.queryByText("enot")).toBeNull();
    fireEvent.click(row("Lounge"));
    expect(handlers.onSelect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Done"));
    expect(handlers.onDoneArranging).toHaveBeenCalledTimes(1);
  });

  it("drops a channel below its last sibling", () => {
    const handlers = arrange(true);
    act(() => pointer(row("Gaming"), "pointerdown", 120));
    act(() => pointer(window, "pointermove", 215));
    flush();
    expect(document.querySelector('[data-testid="channel-arrange-mark"]')).toBeTruthy();
    act(() => pointer(window, "pointerup", 215));
    expect(handlers.onArrange).toHaveBeenCalledWith(2, null);
  });

  it("drops a channel in front of the sibling it is over", () => {
    const handlers = arrange(true);
    act(() => pointer(row("Music"), "pointerdown", 200));
    act(() => pointer(window, "pointermove", 125));
    flush();
    act(() => pointer(window, "pointerup", 125));
    expect(handlers.onArrange).toHaveBeenCalledWith(4, 3);
  });

  it("sends nothing for a drop back where it started", () => {
    const handlers = arrange(true);
    act(() => pointer(row("Lounge"), "pointerdown", 160));
    act(() => pointer(window, "pointermove", 150));
    flush();
    expect(document.querySelector('[data-testid="channel-arrange-mark"]')).toBeNull();
    act(() => pointer(window, "pointerup", 150));
    expect(handlers.onArrange).not.toHaveBeenCalled();
  });

  it("moves the channel you are in, picked up anywhere on its card", () => {
    const handlers = arrange(true, 4);
    const card = row("Music").closest("li")!;
    expect(row("Music").getAttribute("data-arrangeable")).toBe("true");
    act(() => pointer(card, "pointerdown", 200));
    act(() => pointer(window, "pointermove", 105));
    flush();
    act(() => pointer(window, "pointerup", 105));
    expect(handlers.onArrange).toHaveBeenCalledWith(4, 2);
  });

  it("starts from a bare mousedown, which is all WebKitWebDriver sends", () => {
    const handlers = arrange(true);
    act(() => pointer(row("Gaming"), "mousedown", 120));
    act(() => pointer(window, "pointermove", 215));
    act(() => pointer(window, "mouseup", 215));
    expect(handlers.onArrange).toHaveBeenCalledWith(2, null);
  });

  it("leaves a drag on the tree alone outside arrange mode", () => {
    const handlers = arrange(false);
    act(() => pointer(row("Gaming"), "pointerdown", 120));
    act(() => pointer(window, "pointermove", 215));
    flush();
    act(() => pointer(window, "pointerup", 215));
    expect(handlers.onArrange).not.toHaveBeenCalled();
    expect(screen.getByText("enot")).toBeTruthy();
  });
});

describe("ChannelList row marks", () => {
  const initial = useAppStore.getState();
  afterEach(() => {
    viewer = "flat";
    useAppStore.setState({
      broadcastingSessions: initial.broadcastingSessions,
      serverConfig: initial.serverConfig,
      dmUnreadCounts: initial.dmUnreadCounts,
    });
  });

  function draw(users: UserEntry[], extra: Partial<Parameters<typeof ChannelList>[0]> = {}) {
    return render(
      withNebulaTheme(
        <ChannelList
          channels={[
            { channel: channel(2, "Gaming"), depth: 0 },
            { channel: channel(3, "Lounge"), depth: 0 },
          ]}
          users={users}
          selectedChannel={2}
          currentChannel={2}
          talkingSessions={new Set()}
          unreadCounts={{}}
          ownSession={9}
          onSelect={vi.fn()}
          onJoin={vi.fn()}
          onContextMenu={vi.fn()}
          onSelectUser={vi.fn()}
          onHoverUser={vi.fn()}
          onLeaveUser={vi.fn()}
          {...extra}
        />,
      ),
    );
  }

  it("marks the channels being listened to, and only those", () => {
    const { container } = draw([], { listenedChannels: new Set([3]) });
    const marks = container.querySelectorAll("[data-listening]");
    expect(marks).toHaveLength(1);
    expect(marks[0].getAttribute("aria-label")).toBe("Listening");
  });

  it("says a stacked room has someone sharing, where faces carry no badge", () => {
    viewer = "modern";
    useAppStore.setState({ broadcastingSessions: new Set([4]) });
    const { container } = draw([member(4, "Sharer"), member(5, "Watcher")]);
    expect(container.querySelector("[data-user-name]")).toBeNull();
    expect(container.querySelectorAll("[data-live-badge]")).toHaveLength(1);
  });

  it("draws a name in its role's colour", () => {
    draw([member(4, "Mod", { user_id: 12 } as Partial<UserEntry>)], { roleColors: new Map([[12, "#ed4245"]]) });
    // Through `sx`, so the colour is in a generated class rather than an inline style.
    expect(getComputedStyle(screen.getByText("Mod")).color).toBe("rgb(237, 66, 69)");
  });

  it("counts unread direct messages on the person who sent them", () => {
    useAppStore.setState({ dmUnreadCounts: { 4: 3 } });
    const { container } = draw([member(4, "Friend"), member(9, "Me")]);
    const badge = container.querySelector("[data-dm-unread]");
    expect(badge?.textContent).toBe("3");
    expect(badge?.closest('[data-user-name="Friend"]')).toBeTruthy();
  });
});

