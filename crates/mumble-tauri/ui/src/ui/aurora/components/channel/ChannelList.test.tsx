import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChannelEntry, UserEntry } from "@core/types";
import { ChannelAttribute } from "@core/utils/channelAttributes";
import ChannelList from "./ChannelList";
import { flattenChannels } from "./channelOrder";

const channel = (id: number, name: string, parent_id: number | null, position = 0): ChannelEntry => ({
  id,
  name,
  parent_id,
  position,
  description_size: null,
  user_count: 0,
  permissions: null,
  temporary: false,
  max_users: 0,
});

const user = (session: number, name: string, channel_id: number): UserEntry => ({
  session,
  name,
  channel_id,
  user_id: null,
  texture_size: null,
  comment: null,
  mute: false,
  deaf: false,
  suppress: false,
  self_mute: false,
  self_deaf: false,
  priority_speaker: false,
});

const renderList = (
  channels: ChannelEntry[],
  users: UserEntry[] = [],
  props: Partial<React.ComponentProps<typeof ChannelList>> = {},
) =>
  render(
    <ChannelList
      channels={channels}
      users={users}
      selectedChannel={null}
      currentChannel={null}
      listenedChannels={new Set()}
      unreadCounts={{}}
      talkingSessions={new Set()}
      onSelect={vi.fn()}
      onJoin={vi.fn()}
      {...props}
    />,
  );

describe("flattenChannels", () => {
  it("orders parents before their children, each level by position", () => {
    const channels = [
      channel(3, "Beta", 0, 1),
      channel(0, "Root", null),
      channel(2, "Alpha", 0, 0),
      channel(4, "Alpha child", 2),
    ];
    expect(flattenChannels(channels).map((c) => c.name)).toEqual(["Root", "Alpha", "Alpha child", "Beta"]);
  });

  it("falls back to name when positions tie", () => {
    const channels = [channel(1, "Zulu", null, 0), channel(2, "Alpha", null, 0)];
    expect(flattenChannels(channels).map((c) => c.name)).toEqual(["Alpha", "Zulu"]);
  });

  it("keeps channels whose parent is filtered out, and survives a parent cycle", () => {
    const orphan = flattenChannels([channel(9, "Orphan", 404)]);
    expect(orphan.map((c) => c.name)).toEqual(["Orphan"]);

    const cyclic = flattenChannels([channel(1, "A", 2), channel(2, "B", 1)]);
    expect(cyclic).toHaveLength(2);
  });
});

describe("ChannelList", () => {
  it("renders every channel at one level, without nesting", () => {
    renderList([channel(0, "Root", null), channel(1, "Nested", 0), channel(2, "Deep", 1)]);
    const items = screen.getAllByRole("button");
    expect(items.map((item) => item.textContent)).toEqual(["Root", "Nested", "Deep"]);
    // A flat list exposes no expand/collapse affordance.
    expect(screen.queryByRole("button", { name: /expand|collapse/i })).toBeNull();
  });

  it("shows member count and presence for occupied channels", () => {
    renderList([channel(1, "Lounge", null)], [user(10, "Ada", 1), user(11, "Grace", 1)]);
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByTitle("Ada")).toBeTruthy();
    expect(screen.getByTitle("Grace")).toBeTruthy();
  });

  it("renders a structural channel as a heading, not a joinable row", () => {
    const onSelect = vi.fn();
    const structural = {
      ...channel(1, "Voice rooms", null, 0),
      attributes: 1 << ChannelAttribute.Structural,
    };
    renderList([structural, channel(2, "Lounge", 1, 0)], [], { onSelect });

    const heading = screen.getByRole("heading", { name: "Voice rooms" });
    expect(heading).toBeTruthy();
    // A heading is not selectable, so it must not be one of the row buttons.
    expect(screen.queryByRole("button", { name: "Voice rooms" })).toBeNull();
    expect(screen.getByRole("button", { name: "Lounge" })).toBeTruthy();

    fireEvent.click(heading);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("selects on click and joins on double click", () => {
    const onSelect = vi.fn();
    const onJoin = vi.fn();
    renderList([channel(1, "Lounge", null)], [], { onSelect, onJoin });
    const row = screen.getByRole("button", { name: "Lounge" });
    fireEvent.click(row);
    expect(onSelect).toHaveBeenCalledTimes(1);
    fireEvent.doubleClick(row);
    expect(onJoin).toHaveBeenCalledTimes(1);
  });
});
