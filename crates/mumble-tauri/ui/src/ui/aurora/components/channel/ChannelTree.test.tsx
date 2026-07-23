import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChannelEntry } from "@core/types";
import ChannelTree from "./ChannelTree";

const channel = (id: number, name: string, parent_id: number | null): ChannelEntry => ({ id, name, parent_id, description_size: null, user_count: 0, permissions: null, temporary: false, position: id, max_users: 0 });

describe("ChannelTree", () => {
  it("renders nested channels and hides descendants of collapsed channels", () => {
    const channels = [channel(0, "Root", null), channel(1, "Lobby", 0), channel(2, "Games", 1)];
    const onToggle = vi.fn();
    const { rerender } = render(<ChannelTree channels={channels} collapsed={new Set()} currentChannel={null} selectedChannel={null} unreadCounts={{}} onSelect={vi.fn()} onToggle={onToggle} />);
    expect(screen.getByText("Games")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Collapse Lobby" }));
    expect(onToggle).toHaveBeenCalledWith(1);
    rerender(<ChannelTree channels={channels} collapsed={new Set([1])} currentChannel={null} selectedChannel={null} unreadCounts={{}} onSelect={vi.fn()} onToggle={onToggle} />);
    expect(screen.queryByText("Games")).toBeNull();
    expect(screen.getByRole("button", { name: "Expand Lobby" })).toBeTruthy();
  });
});
