/**
 * The registered users' "Last channel" column names the channel.
 *
 * The bug: the column printed the channel's id ("0", "70") where its name
 * belongs, and sorted by that id.
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelEntry, RegisteredUser } from "@core/types";

const listeners = new Map<string, (event: { payload: unknown }) => void>();
vi.mock("@tauri-apps/api/core", () => ({ invoke: () => Promise.resolve(undefined) }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, handler: (event: { payload: unknown }) => void) => {
    listeners.set(event, handler);
    return Promise.resolve(() => listeners.delete(event));
  },
}));

import { useAppStore } from "@core/store";
import { compareLastChannels, lastChannel } from "@core/features/admin/lastChannel";
import { withNebulaTheme } from "../../testTheme";
import { UsersAdmin } from "./UsersAdmin";

const CHANNELS = [
  { id: 0, parent_id: null, name: "Magical Rocks" },
  { id: 6, parent_id: 0, name: "Lounge" },
  { id: 9, parent_id: 0, name: "AFK" },
] as unknown as ChannelEntry[];

const USERS: RegisteredUser[] = [
  { user_id: 1, name: "rooted", last_channel: 0 },
  { user_id: 2, name: "lounging", last_channel: 6 },
  { user_id: 3, name: "gone", last_channel: 70 },
  { user_id: 4, name: "nowhere", last_channel: null },
  { user_id: 5, name: "afk", last_channel: 9 },
];

/** The "Last channel" cell of every row, top to bottom. */
function lastChannelCells(): string[] {
  return screen.getAllByTestId("registered-user-row").map((row) => row.querySelectorAll("td")[2]?.textContent ?? "");
}

beforeEach(() => {
  listeners.clear();
  useAppStore.setState({ channels: CHANNELS, users: [] });
});

describe("lastChannel", () => {
  it("names a channel by the list the client holds, the root one included", () => {
    expect(lastChannel(0, CHANNELS)).toEqual({ kind: "named", name: "Magical Rocks" });
    expect(lastChannel(6, CHANNELS)).toEqual({ kind: "named", name: "Lounge" });
    expect(lastChannel(70, CHANNELS)).toEqual({ kind: "deleted" });
    expect(lastChannel(null, CHANNELS)).toEqual({ kind: "unknown" });
  });

  it("sorts by name, then deleted, then unknown", () => {
    const sorted = [70, null, 6, 0, 9]
      .map((id) => lastChannel(id, CHANNELS))
      .sort(compareLastChannels)
      .map((where) => (where.kind === "named" ? where.name : where.kind));
    expect(sorted).toEqual(["AFK", "Lounge", "Magical Rocks", "deleted", "unknown"]);
  });
});

describe("UsersAdmin last channel column", () => {
  it("shows names and says when a channel is gone, never a bare id", async () => {
    render(withNebulaTheme(<UsersAdmin />));
    await waitFor(() => expect(listeners.has("user-list")).toBe(true));
    act(() => listeners.get("user-list")?.({ payload: USERS }));

    const cells = lastChannelCells();
    expect(cells).toEqual(["AFK", "Deleted channel", "Lounge", "Unknown", "Magical Rocks"]);
    expect(cells.some((cell) => /^\d+$/.test(cell))).toBe(false);

    fireEvent.click(screen.getByText("Last Channel"));
    expect(lastChannelCells()).toEqual(["AFK", "Lounge", "Magical Rocks", "Deleted channel", "Unknown"]);
  });
});
