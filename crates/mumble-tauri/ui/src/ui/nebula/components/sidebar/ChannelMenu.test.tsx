import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelEntry } from "@core/types";
import { PERM_WRITE } from "@core/utils/permissions";
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
    onEdit: vi.fn(),
    onEditPermissions: vi.fn(),
    onClose: vi.fn(),
  };
  render(
    withNebulaTheme(
      <ChannelMenu
        target={{ channel: channel(), x: 120, y: 240 }}
        listening={false}
        notificationsMuted={false}
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

  it("joins the channel it was opened on, then closes", () => {
    const handlers = open();
    fireEvent.click(screen.getByText("Join channel"));
    expect(actions.joinChannel).toHaveBeenCalledWith(3);
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
    hideEmpty: false,
    onToggleHideEmpty: vi.fn(),
    onEdit: vi.fn(),
    onEditPermissions: vi.fn(),
    onClose: vi.fn(),
  };
}
