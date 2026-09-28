import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { withNebulaTheme } from "../../testTheme";
import type { ServerRailEntry, ServerRailStatus } from "../../selectors";
import { ServerRailPanel } from "./ServerRailPanel";

vi.mock("@core/lazyBlobs", () => ({ useUserAvatar: () => null }));

const entry = (host: string, status: ServerRailStatus, unread = 0, identities = 0): ServerRailEntry => ({
  group: {
    key: host + ":64738",
    label: host,
    host,
    port: 64738,
    identities: Array.from({ length: identities }, () => ({}) as never),
    favorite: false,
    sessionId: status === "saved" ? null : "s-" + host,
  },
  session: null,
  status,
  unread,
});

const panel = (props: Partial<Parameters<typeof ServerRailPanel>[0]> = {}) =>
  render(
    withNebulaTheme(
      <ServerRailPanel
        entries={[entry("magical.rocks", "connected"), entry("kumo.jp", "saved", 12, 2)]}
        activeKey="magical.rocks:64738"
        pings={
          new Map([
            ["magical.rocks:64738", { online: true, user_count: 3, max_user_count: 101, latency_ms: 18 }],
            ["kumo.jp:64738", { online: true, user_count: 0, max_user_count: 101 }],
          ]) as never
        }
        activeChannelName="Gaming"
        onClose={() => {}}
        onSelect={() => {}}
        onAddServer={() => {}}
        {...props}
      />,
    ),
  );

describe("ServerRailPanel", () => {
  it("says where you are on the server you are connected to", () => {
    panel();
    expect(screen.getByText("3/101 · 18 ms · in #Gaming")).toBeTruthy();
  });

  it("counts the logins you keep for a server you are not on", () => {
    panel();
    expect(screen.getByText("0/101 online · 2 identities")).toBeTruthy();
  });

  it("says only that a server is being reached while it is connecting", () => {
    // Occupancy and latency are not known yet, so printing them would be a
    // guess dressed up as a reading.
    panel({ entries: [entry("localhost", "connecting")] });
    expect(screen.getByText("connecting…")).toBeTruthy();
  });

  it("closes on the header control", () => {
    const onClose = vi.fn();
    panel({ onClose });
    fireEvent.click(screen.getByRole("button", { name: /Collapse the server list/ }));
    expect(onClose).toHaveBeenCalled();
  });

  it("offers no way to collapse the column it is", () => {
    // Pinned, the panel is the screen's sidebar. A close button would take the
    // list away and leave the screen with no server list at all.
    panel({ pinned: true, onClose: undefined });
    expect(screen.queryByRole("button", { name: /Collapse the server list/ })).toBeNull();
    expect(screen.queryByText(/Hover a tile/)).toBeNull();
  });

  it("carries the search field it is given", () => {
    panel({ pinned: true, search: <input aria-label="Search servers" /> });
    expect(screen.getByLabelText("Search servers")).toBeTruthy();
  });

  it("says so when the search matches nothing", () => {
    panel({ pinned: true, entries: [], empty: "No server matches that." });
    expect(screen.getByText("No server matches that.")).toBeTruthy();
  });

  it("leaves an empty list to the add button when there is nothing to filter", () => {
    // With no servers saved at all, "nothing matched" would be a lie about a
    // search the user never ran.
    panel({ pinned: true, entries: [] });
    expect(screen.queryByText(/No server matches/)).toBeNull();
    expect(screen.getByRole("button", { name: /Add a server/ })).toBeTruthy();
  });

  it("favourites a server from its row", () => {
    const onToggleFavorite = vi.fn();
    panel({ onToggleFavorite });
    fireEvent.click(screen.getAllByRole("button", { name: "Add to favourites" })[1]);
    expect(onToggleFavorite.mock.calls[0][0].host).toBe("kumo.jp");
  });

  it("draws no star where favouriting is not offered", () => {
    panel();
    expect(screen.queryByRole("button", { name: /favourites/ })).toBeNull();
  });
});
