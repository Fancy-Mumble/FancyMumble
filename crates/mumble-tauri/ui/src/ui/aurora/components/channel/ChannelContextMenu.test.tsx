import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChannelEntry } from "@core/types";
import { ChannelAttribute } from "@core/utils/channelAttributes";
import ChannelContextMenu from "./ChannelContextMenu";

const channel = (overrides: Partial<ChannelEntry> = {}): ChannelEntry => ({
  id: 1,
  name: "Lounge",
  parent_id: 0,
  position: 0,
  description_size: null,
  user_count: 0,
  permissions: null,
  temporary: false,
  max_users: 0,
  ...overrides,
});

const noop = vi.fn();
const renderMenu = (
  entry: ChannelEntry,
  overrides: Partial<React.ComponentProps<typeof ChannelContextMenu>> = {},
) =>
  render(
    <ChannelContextMenu
      channel={entry}
      x={10}
      y={10}
      listening={false}
      notificationsMuted={false}
      onOpenText={noop}
      onJoinVoice={noop}
      onToggleListen={noop}
      onToggleNotifications={noop}
      onCreateSubchannel={noop}
      onEdit={noop}
      onEditPermissions={noop}
      onMove={noop}
      onMoveAllUsers={noop}
      onPurgeHistory={noop}
      {...overrides}
    />,
  );

describe("ChannelContextMenu", () => {
  it("groups items with separators under a heading", () => {
    renderMenu(channel());
    const menu = screen.getByRole("menu", { name: "Actions for Lounge" });
    expect(menu.textContent).toContain("#Lounge");
    expect(screen.getAllByRole("separator").length).toBeGreaterThan(0);
  });

  it("marks only the destructive action as dangerous", () => {
    renderMenu(channel({ pchat_protocol: "fancy_v1_full_archive" }));
    const purge = screen.getByRole("menuitem", { name: /Purge history/ });
    expect(purge.getAttribute("data-tone")).toBe("danger");
    expect(screen.getByRole("menuitem", { name: "Join voice" }).getAttribute("data-tone")).toBe("default");
  });

  it("hides the purge action when the channel keeps no history", () => {
    renderMenu(channel({ pchat_protocol: "none" }));
    expect(screen.queryByRole("menuitem", { name: /Purge history/ })).toBeNull();
  });

  it("omits entry actions for a structural channel, which is a heading not a room", () => {
    renderMenu(channel({ name: "Voice rooms", attributes: 1 << ChannelAttribute.Structural }));
    expect(screen.queryByRole("menuitem", { name: "Join voice" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /Listen only/ })).toBeNull();
    // Configuration still applies to a category.
    expect(screen.getByRole("menuitem", { name: "Edit category" })).toBeTruthy();
  });

  it("reports the move direction", () => {
    const onMove = vi.fn();
    renderMenu(channel(), { onMove });
    fireEvent.click(screen.getByRole("menuitem", { name: "Move up" }));
    expect(onMove).toHaveBeenCalledWith(-1);
    fireEvent.click(screen.getByRole("menuitem", { name: "Move down" }));
    expect(onMove).toHaveBeenCalledWith(1);
  });
});
