import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelEntry } from "@core/types";
import {
  PERM_DELETE_MESSAGE,
  PERM_MAKE_CHANNEL,
  PERM_MAKE_TEMP_CHANNEL,
  PERM_WRITE,
} from "@core/utils/permissions";
import { ChannelAttribute } from "@core/utils/channelAttributes";
import { DM_CHANNEL_PREFIX } from "@core/utils/channelVisibility";
import { TID } from "@core/testids";
import { withNebulaTheme } from "../../testTheme";
import { ChannelMenu } from "./ChannelMenu";
import { popupActions, closeAllPopups } from "../../clientState";

const actions = {
  selectChannel: vi.fn(),
  joinChannel: vi.fn(),
  toggleListen: vi.fn(),
  toggleMutePushChannel: vi.fn(),
};

/**
 * The roster and the two channel sets the menu now reads for itself.
 *
 * It used to be handed `listening`, `notificationsMuted` and `occupantCount` by
 * the shell, which meant the shell had to know a menu was open and re-render
 * the whole client to work them out. The menu asks the store instead, so the
 * mock has to answer a selector rather than only `getState`.
 */
const storeState = {
  ...actions,
  listenedChannels: new Set<number>(),
  mutedPushChannels: new Set<number>(),
  users: [] as { session: number; channel_id: number }[],
};

vi.mock("@core/store", () => ({
  useAppStore: Object.assign(
    (selector: (state: typeof storeState) => unknown) => selector(storeState),
    { getState: () => storeState },
  ),
}));

const leaveMeeting = vi.fn();
vi.mock("@core/features/chat/calendar/meetings", () => ({
  requestLeaveMeeting: (channelId: number) => leaveMeeting(channelId),
}));

const channel = (partial: Partial<ChannelEntry> = {}) =>
  ({
    id: 3,
    name: "Gaming",
    parent_id: 0,
    description_size: null,
    user_count: 2,
    permissions: PERM_WRITE,
    attributes: 0,
    ...partial,
  }) as unknown as ChannelEntry;

/**
 * What used to be props and is now state the menu reads for itself.
 *
 * The call sites are unchanged on purpose: which channel, whether it is being
 * listened to and how many people are in it are still the facts each test is
 * setting up - only where the menu gets them from has moved.
 */
interface OpenOptions extends Partial<React.ComponentProps<typeof ChannelMenu>> {
  target?: { channel: ChannelEntry; x: number; y: number };
  listening?: boolean;
  notificationsMuted?: boolean;
  occupantCount?: number;
}

function open({ target, listening, notificationsMuted, occupantCount, ...props }: OpenOptions = {}) {
  const subject = target?.channel ?? channel();
  storeState.listenedChannels = new Set(listening ? [subject.id] : []);
  storeState.mutedPushChannels = new Set(notificationsMuted ? [subject.id] : []);
  storeState.users = Array.from({ length: occupantCount ?? 2 }, (_, index) => ({
    session: index + 1,
    channel_id: subject.id,
  }));
  popupActions.openChannelMenu(subject, {
    preventDefault: () => {},
    clientX: target?.x ?? 120,
    clientY: target?.y ?? 240,
  } as unknown as React.MouseEvent);

  const handlers = {
    onToggleHideEmpty: vi.fn(),
    onJoin: vi.fn(),
    onShowInfo: vi.fn(),
    onInvite: vi.fn(),
    onEdit: vi.fn(),
    onCreate: vi.fn(),
    onMoveAllUsers: vi.fn(),
    onPurgeHistory: vi.fn(),
    onDelete: vi.fn(),
    onEditPermissions: vi.fn(),
    onToggleArrange: vi.fn(),
  };
  render(withNebulaTheme(<ChannelMenu hideEmpty={false} arranging={false} {...handlers} {...props} />));
  return handlers;
}

/** Closing is the store's now, so it is read off the screen rather than a spy. */
function expectClosed() {
  expect(screen.queryByRole("menu")).toBeNull();
}

describe("ChannelMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    closeAllPopups();
  });

  it("renders nothing until a row is right-clicked", () => {
    render(withNebulaTheme(<ChannelMenu {...open_props()} />));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("offers the mock's four groups", () => {
    open();
    for (const label of [
      "Open text chat",
      "Join channel",
      "Listen in",
      "Mute channel",
      "Hide empty channels",
      "Edit channel",
      "Permissions…",
    ])
      expect(screen.getByText(label)).toBeTruthy();
  });

  it("hands the channel it was opened on back to the shell to enter, then closes", () => {
    // The shell, not the store: a restricted room has a password to ask
    // for first, and the menu is not the surface that asks it.
    const handlers = open();
    fireEvent.click(screen.getByText("Join channel"));
    expect(handlers.onJoin).toHaveBeenCalledWith(expect.objectContaining({ id: 3 }));
    expect(actions.joinChannel).not.toHaveBeenCalled();
    expectClosed();
  });

  it("names the reverse of the current listen and notification state", () => {
    open({ listening: true, notificationsMuted: true });
    expect(screen.getByText("Stop listening in")).toBeTruthy();
    expect(screen.getByText("Unmute channel")).toBeTruthy();
  });

  it("toggles the shared empty-channel filter", () => {
    const handlers = open({ hideEmpty: true });
    fireEvent.click(screen.getByText("Hide empty channels"));
    expect(handlers.onToggleHideEmpty).toHaveBeenCalled();
    expectClosed();
  });

  it("hands the channel to the editor and the permission surface", () => {
    // Opened twice rather than clicked twice: choosing an entry now really does
    // dismiss the menu, where the close used to be a spy that did nothing.
    const first = open();
    fireEvent.click(screen.getByText("Edit channel"));
    expect(first.onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 3 }));
    cleanup();

    const second = open();
    fireEvent.click(screen.getByText("Permissions…"));
    expect(second.onEditPermissions).toHaveBeenCalledWith(expect.objectContaining({ id: 3 }));
  });

  it("drops the administrative pair without write permission", () => {
    open({ target: { channel: channel({ permissions: 0 }), x: 0, y: 0 } });
    expect(screen.queryByText("Edit channel")).toBeNull();
    expect(screen.queryByText("Permissions…")).toBeNull();
  });

  it("keeps the administrative pair while permissions are unknown", () => {
    open({ target: { channel: channel({ permissions: null }), x: 0, y: 0 } });
    expect(screen.getByText("Edit channel")).toBeTruthy();
  });

  it("omits the entry actions on a structural channel", () => {
    open({
      target: {
        channel: channel({ attributes: 1 << ChannelAttribute.Structural }),
        x: 0,
        y: 0,
      },
    });
    expect(screen.queryByText("Join channel")).toBeNull();
    expect(screen.queryByText("Mute channel")).toBeNull();
    expect(screen.getByText("Edit category")).toBeTruthy();
    expect(screen.getByText("Hide empty channels")).toBeTruthy();
  });
});

function open_props() {
  return {
    hideEmpty: false,
    arranging: false,
    onToggleHideEmpty: vi.fn(),
    onJoin: vi.fn(),
    onShowInfo: vi.fn(),
    onInvite: vi.fn(),
    onEdit: vi.fn(),
    onCreate: vi.fn(),
    onMoveAllUsers: vi.fn(),
    onPurgeHistory: vi.fn(),
    onDelete: vi.fn(),
    onEditPermissions: vi.fn(),
    onToggleArrange: vi.fn(),
  };
}

describe("ChannelMenu administration", () => {
  it("offers creating a sub-channel only where MakeChannel was granted", () => {
    open({ target: { channel: channel({ permissions: PERM_WRITE }), x: 0, y: 0 } });
    expect(screen.queryByText("New channel here")).toBeNull();

    cleanup();
    open({
      target: { channel: channel({ permissions: PERM_WRITE | PERM_MAKE_CHANNEL }), x: 0, y: 0 },
    });
    expect(screen.getByText("New channel here")).toBeTruthy();
  });

  it("says temporary when that is all the server allows", () => {
    open({
      target: { channel: channel({ permissions: PERM_MAKE_TEMP_CHANNEL }), x: 0, y: 0 },
    });
    expect(screen.getByText("New temporary channel here")).toBeTruthy();
  });

  it("passes the parent and the temp-only answer to the caller", () => {
    const handlers = open({
      target: { channel: channel({ id: 9, permissions: PERM_MAKE_TEMP_CHANNEL }), x: 0, y: 0 },
    });
    fireEvent.click(screen.getByText("New temporary channel here"));
    expect(handlers.onCreate).toHaveBeenCalledWith(expect.objectContaining({ id: 9 }), true);
  });

  it("never offers to delete the root channel", () => {
    open({ target: { channel: channel({ id: 0, permissions: PERM_WRITE }), x: 0, y: 0 } });
    expect(screen.queryByText("Delete channel")).toBeNull();
  });

  it("asks the caller to delete rather than deleting itself", () => {
    const handlers = open({
      target: { channel: channel({ id: 4, permissions: PERM_WRITE }), x: 0, y: 0 },
    });
    fireEvent.click(screen.getByText("Delete channel"));
    expect(handlers.onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 4 }));
    expect(actions.selectChannel).not.toHaveBeenCalled();
  });
});

describe("ChannelMenu, acting on the room", () => {
  it("describes the channel without entering it", () => {
    const handlers = open({ target: { channel: channel({ id: 6 }), x: 0, y: 0 } });
    fireEvent.click(screen.getByText("Channel info"));
    expect(handlers.onShowInfo).toHaveBeenCalledWith(expect.objectContaining({ id: 6 }));
    expect(actions.joinChannel).not.toHaveBeenCalled();
  });

  it("offers to move the room only where there is a room to move", () => {
    // Write, but nobody in it: an action with no subject.
    open({ occupantCount: 0 });
    expect(screen.queryByText("Move all users to...")).toBeNull();
    cleanup();

    // Somebody in it, but no Write: the server would refuse.
    open({ occupantCount: 3, target: { channel: channel({ permissions: 0 }), x: 0, y: 0 } });
    expect(screen.queryByText("Move all users to...")).toBeNull();
    cleanup();

    const handlers = open({
      occupantCount: 3,
      target: { channel: channel({ id: 5, permissions: PERM_WRITE }), x: 0, y: 0 },
    });
    fireEvent.click(screen.getByText("Move all users to..."));
    expect(handlers.onMoveAllUsers).toHaveBeenCalledWith(expect.objectContaining({ id: 5 }));
  });

  it("offers to purge only where the server keeps a history and grants deleting it", () => {
    // The grant without a stored history is nothing to purge...
    open({
      target: { channel: channel({ permissions: PERM_WRITE | PERM_DELETE_MESSAGE }), x: 0, y: 0 },
    });
    expect(screen.queryByText("Purge chat history")).toBeNull();
    cleanup();

    // ...and a stored history without the grant is not this user's to empty.
    open({
      target: {
        channel: channel({ permissions: PERM_WRITE, pchat_protocol: "signal_v1" }),
        x: 0,
        y: 0,
      },
    });
    expect(screen.queryByText("Purge chat history")).toBeNull();
    cleanup();

    const handlers = open({
      target: {
        channel: channel({ id: 8, permissions: PERM_DELETE_MESSAGE, pchat_protocol: "signal_v1" }),
        x: 0,
        y: 0,
      },
    });
    fireEvent.click(screen.getByText("Purge chat history"));
    expect(handlers.onPurgeHistory).toHaveBeenCalledWith(expect.objectContaining({ id: 8 }));
  });
});

describe("ChannelMenu arrange mode", () => {
  it("offers to arrange the list to someone who can edit channels", () => {
    const handlers = open();
    fireEvent.click(screen.getByText("Arrange channels"));
    expect(handlers.onToggleArrange).toHaveBeenCalledTimes(1);
    expectClosed();
  });

  it("offers the way back out while arranging", () => {
    open({ arranging: true });
    expect(screen.getByText("Done arranging")).toBeTruthy();
    expect(screen.queryByText("Arrange channels")).toBeNull();
  });

  it("is not offered without write on the channel", () => {
    open({ target: { channel: channel({ permissions: 0 }), x: 0, y: 0 } });
    expect(screen.queryByText("Arrange channels")).toBeNull();
  });
  it("offers leaving a meeting room, and asks the calendar to revoke it", () => {
    leaveMeeting.mockClear();
    open({ target: { channel: channel({ id: 41, name: "Standup", detached: true }), x: 1, y: 1 } });
    const item = screen.getByTestId(TID.leaveMeeting);
    expect(item.textContent).toBe("Leave meeting");
    fireEvent.click(item);
    expect(leaveMeeting).toHaveBeenCalledWith(41);
    expectClosed();
  });

  it("offers no leaving on a channel of the tree or on a friend chat", () => {
    open();
    expect(screen.queryByTestId(TID.leaveMeeting)).toBeNull();
    cleanup();
    open({ target: { channel: channel({ detached: true, name: `${DM_CHANNEL_PREFIX}3-9` }), x: 1, y: 1 } });
    expect(screen.queryByTestId(TID.leaveMeeting)).toBeNull();
  });
});
