import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@core/store";
import type { ChannelEntry, UserEntry } from "@core/types";
import {
  PERM_DELETE_MESSAGE,
  PERM_MOVE,
  PERM_MUTE_DEAFEN,
  PERM_REGISTER,
} from "@core/utils/permissions";
import { withNebulaTheme } from "../../testTheme";
import { UserMenu } from "./UserMenu";

const invokeMock = vi.fn().mockResolvedValue(null);
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

const friends = { list: [] as { id: string; userHash?: string; userName: string }[] };
vi.mock("@core/friendsStorage", () => ({
  FRIENDS_CHANGED_EVENT: "fancy:friends-changed",
  getFriends: () => Promise.resolve(friends.list),
  addFriend: vi.fn().mockResolvedValue(undefined),
  removeFriend: vi.fn().mockResolvedValue(undefined),
}));

const TARGET: UserEntry = {
  session: 7,
  name: "ZewiWin",
  channel_id: 4,
  user_id: 3,
  texture_size: null,
  mute: false,
  deaf: false,
  suppress: false,
  self_mute: false,
  self_deaf: false,
  priority_speaker: false,
  hash: "abc",
} as UserEntry;

const channel = (id: number, name: string, permissions: number | null): ChannelEntry =>
  ({ id, name, parent_id: 0, position: 0, user_count: 1, permissions, attributes: 0 }) as unknown as ChannelEntry;

function open(
  user: Partial<UserEntry> = {},
  options: {
    rootPermissions?: number;
    targetChannelPermissions?: number;
    /** The channel whose conversation is on screen - what "their messages" means. */
    openChannel?: Partial<ChannelEntry>;
    onMessage?: boolean;
  } = {},
) {
  const target = { ...TARGET, ...user };
  useAppStore.setState({
    ownSession: 1,
    currentChannel: 2,
    selectedChannel: 2,
    users: [target],
    userVolumes: {},
    channels: [
      channel(0, "Root", options.rootPermissions ?? 0),
      { ...channel(2, "Lounge", 0), ...options.openChannel },
      channel(4, "Gaming", options.targetChannelPermissions ?? 0),
    ],
  } as never);

  const onClose = vi.fn();
  const onMessage = vi.fn();
  render(
    withNebulaTheme(
      <UserMenu
        target={{ user: target, x: 40, y: 60 }}
        onClose={onClose}
        onMessage={options.onMessage === false ? undefined : onMessage}
      />,
    ),
  );
  return { onClose, onMessage };
}

describe("UserMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    friends.list = [];
  });

  it("shows nothing until a row is right-clicked", () => {
    render(withNebulaTheme(<UserMenu target={null} onClose={vi.fn()} />));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("offers the personal actions to anyone, with no permissions at all", () => {
    open();
    expect(screen.getByLabelText("Volume for ZewiWin")).toBeTruthy();
    expect(screen.getByText("Add friend")).toBeTruthy();
    expect(screen.getByText("Message")).toBeTruthy();
    expect(screen.getByText("Join Gaming")).toBeTruthy();
  });

  it("keeps every moderation action off a menu the server has granted nothing on", () => {
    open();
    for (const label of ["Mute on server", "Move to channel…", "Kick", "Ban", "Register on server…"])
      expect(screen.queryByText(label)).toBeNull();
  });

  it("offers mute, deafen, priority and move on the channel the target is sitting in", () => {
    open({}, { targetChannelPermissions: PERM_MUTE_DEAFEN | PERM_MOVE });
    expect(screen.getByText("Mute on server")).toBeTruthy();
    expect(screen.getByText("Deafen on server")).toBeTruthy();
    expect(screen.getByText("Priority speaker")).toBeTruthy();
    expect(screen.getByText("Move to channel…")).toBeTruthy();
    // Kick and ban are root permissions, and root granted nothing.
    expect(screen.queryByText("Kick")).toBeNull();
  });

  it("does not offer mute from a permission held somewhere else", () => {
    // Held on the channel *we* are in, not the one the target sits in.
    useAppStore.setState({ channels: [] } as never);
    open({}, { rootPermissions: PERM_MUTE_DEAFEN });
    expect(screen.queryByText("Mute on server")).toBeNull();
  });

  it("names the reverse of the state it would put the user in", () => {
    open({ mute: true, deaf: true, priority_speaker: true }, { targetChannelPermissions: PERM_MUTE_DEAFEN });
    expect(screen.getByText("Unmute on server")).toBeTruthy();
    expect(screen.getByText("Undeafen on server")).toBeTruthy();
    expect(screen.getByText("Remove priority speaker")).toBeTruthy();
  });

  it("mutes through the backend and closes", () => {
    const { onClose } = open({}, { targetChannelPermissions: PERM_MUTE_DEAFEN });
    fireEvent.click(screen.getByText("Mute on server"));
    expect(invokeMock).toHaveBeenCalledWith("mute_user", { session: 7, muted: true });
    expect(onClose).toHaveBeenCalled();
  });

  it("offers registration only for an account that does not have one", () => {
    open({ user_id: null }, { rootPermissions: PERM_REGISTER });
    expect(screen.getByText("Register on server…")).toBeTruthy();
    expect(screen.queryByText("Deregister…")).toBeNull();
  });

  it("offers deregistration for a registered account", () => {
    open({ user_id: 3 }, { rootPermissions: PERM_REGISTER });
    expect(screen.getByText("Deregister…")).toBeTruthy();
    expect(screen.queryByText("Register on server…")).toBeNull();
  });

  it("never offers to deregister SuperUser, whose account must survive", () => {
    // SuperUser is user_id 0, which reads as unregistered here - that is what
    // keeps the account-deleting action off the one account that needs it.
    open({ user_id: 0 }, { rootPermissions: PERM_REGISTER });
    expect(screen.queryByText("Deregister…")).toBeNull();
  });

  it("asks before deregistering, and only acts on confirmation", async () => {
    open({}, { rootPermissions: PERM_REGISTER });
    fireEvent.click(screen.getByText("Deregister…"));
    expect(screen.getByText("Deregister this user?")).toBeTruthy();
    expect(invokeMock).not.toHaveBeenCalledWith("update_user_list", expect.anything());

    fireEvent.click(screen.getByRole("button", { name: "Deregister" }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("update_user_list", {
        users: [{ user_id: 3, name: null }],
      }),
    );
  });

  it("keeps the confirmation open after the menu that raised it has closed", () => {
    const { onClose } = open({}, { rootPermissions: PERM_REGISTER });
    fireEvent.click(screen.getByText("Deregister…"));
    expect(onClose).toHaveBeenCalled();
    // The menu is gone, but its dialog holds its own copy of the target.
    expect(screen.getByText("Deregister this user?")).toBeTruthy();
  });

  it("lists somewhere to move to, excluding the channel the user is already in", async () => {
    open({}, { targetChannelPermissions: PERM_MOVE });
    fireEvent.click(screen.getByText("Move to channel…"));
    expect(screen.getByText("Lounge")).toBeTruthy();
    expect(screen.queryByText("Gaming")).toBeNull();

    fireEvent.click(screen.getByText("Lounge"));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("move_user_to_channel", { session: 7, channelId: 2 }),
    );
  });

  it("offers message deletion where the channel on screen keeps history and grants it", () => {
    open({}, { openChannel: { permissions: PERM_DELETE_MESSAGE, pchat_protocol: "fancy_v1" } as never });
    expect(screen.getByText("Delete their messages…")).toBeTruthy();
  });

  it("withholds message deletion from a channel that keeps no history", () => {
    open({}, { openChannel: { permissions: PERM_DELETE_MESSAGE, pchat_protocol: "none" } as never });
    expect(screen.queryByText("Delete their messages…")).toBeNull();
  });

  it("withholds message deletion without the permission, however the channel is set up", () => {
    open({}, { openChannel: { permissions: 0, pchat_protocol: "fancy_v1" } as never });
    expect(screen.queryByText("Delete their messages…")).toBeNull();
  });

  it("offers nothing at all against yourself", () => {
    open({ session: 1 });
    expect(screen.getByText(/That.s you/)).toBeTruthy();
    expect(screen.queryByText("Add friend")).toBeNull();
    expect(screen.queryByLabelText("Volume for ZewiWin")).toBeNull();
  });

  it("names the friend action for the state it would leave you in", async () => {
    friends.list = [{ id: "f1", userHash: "abc", userName: "ZewiWin" }];
    open();
    await waitFor(() => expect(screen.getByText("Remove friend")).toBeTruthy());
  });

  it("commits a volume change to the backend and to the store", () => {
    open();
    const slider = screen.getByLabelText("Volume for ZewiWin");
    fireEvent.change(slider, { target: { value: "40" } });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    fireEvent.keyUp(slider, { key: "ArrowRight" });
    expect(invokeMock).toHaveBeenCalledWith(
      "set_user_volume",
      expect.objectContaining({ session: 7 }),
    );
  });

  it("drops Message when the host has nowhere to open a conversation", () => {
    open({}, { onMessage: false });
    expect(screen.queryByText("Message")).toBeNull();
  });
});
