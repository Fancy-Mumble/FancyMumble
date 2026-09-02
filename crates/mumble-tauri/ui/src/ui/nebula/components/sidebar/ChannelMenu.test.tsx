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
import { withNebulaTheme } from "../../testTheme";
import { ChannelMenu } from "./ChannelMenu";

const actions = {
  selectChannel: vi.fn(),
  joinChannel: vi.fn(),
  toggleListen: vi.fn(),
  toggleMutePushChannel: vi.fn(),
};

vi.mock("@core/store", () => ({ useAppStore: { getState: () => actions } }));

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

function open(props: Partial<React.ComponentProps<typeof ChannelMenu>> = {}) {
  const handlers = {
    onToggleHideEmpty: vi.fn(),
    onJoin: vi.fn(),
    onShowInfo: vi.fn(),
    onEdit: vi.fn(),
    onCreate: vi.fn(),
    onMoveAllUsers: vi.fn(),
    onPurgeHistory: vi.fn(),
    onDelete: vi.fn(),
    onEditPermissions: vi.fn(),
    onClose: vi.fn(),
  };
  render(
    withNebulaTheme(
      <ChannelMenu
        target={{ channel: channel(), x: 120, y: 240 }}
        listening={false}
        notificationsMuted={false}
        occupantCount={2}
        hideEmpty={false}
        {...handlers}
        {...props}
      />,
    ),
  );
  return handlers;
}

describe("ChannelMenu", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders nothing until a row is right-clicked", () => {
    render(withNebulaTheme(<ChannelMenu target={null} {...open_props()} />));
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
    expect(handlers.onClose).toHaveBeenCalled();
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
    expect(handlers.onClose).toHaveBeenCalled();
  });

  it("hands the channel to the editor and the permission surface", () => {
    const handlers = open();
    fireEvent.click(screen.getByText("Edit channel"));
    expect(handlers.onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 3 }));
    fireEvent.click(screen.getByText("Permissions…"));
    expect(handlers.onEditPermissions).toHaveBeenCalledWith(expect.objectContaining({ id: 3 }));
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
    listening: false,
    notificationsMuted: false,
    occupantCount: 2,
    hideEmpty: false,
    onToggleHideEmpty: vi.fn(),
    onJoin: vi.fn(),
    onShowInfo: vi.fn(),
    onEdit: vi.fn(),
    onCreate: vi.fn(),
    onMoveAllUsers: vi.fn(),
    onPurgeHistory: vi.fn(),
    onDelete: vi.fn(),
    onEditPermissions: vi.fn(),
    onClose: vi.fn(),
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
