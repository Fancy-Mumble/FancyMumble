import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { withNebulaTheme } from "../../testTheme";
import type { ServerRailEntry } from "../../selectors";
import { TitleBar } from "./TitleBar";

const entry = (host: string, label = host): ServerRailEntry => ({
  group: {
    key: host + ":64738",
    label,
    host,
    port: 64738,
    identities: [],
    favorite: false,
    sessionId: "s-" + host,
  },
  session: null,
  status: "connected",
  unread: 0,
});

const bar = (props: Partial<Parameters<typeof TitleBar>[0]> = {}) =>
  render(
    withNebulaTheme(
      <TitleBar
        friendsActive={false}
        onOpenFriends={() => {}}
        quickConnectOpen={false}
        entries={[entry("magical.rocks", "Magical Rocks"), entry("voice.kumo.gg", "Kumo")]}
        activeKey="magical.rocks:64738"
        {...props}
      />,
    ),
  );

describe("the title bar with the server strip on", () => {
  it("lists every server as a tab", () => {
    bar({ tabs: true, serverLabel: "Magical Rocks" });
    expect(screen.getByText("Magical Rocks")).toBeTruthy();
    expect(screen.getByText("Kumo")).toBeTruthy();
  });

  it("offers to leave the server whose tab is current", () => {
    bar({ tabs: true, onDisconnect: () => {} });
    expect(screen.getByLabelText("Disconnect from Magical Rocks")).toBeTruthy();
  });
});

describe("hovering a tab", () => {
  // By the strip, not by the text: once the card is open the name is on it too.
  const tabOf = (label: string) => {
    const tab = screen.getAllByTestId("nebula-server-tab").find((el) => el.textContent?.includes(label));
    if (!tab) throw new Error("no tab for " + label);
    return tab;
  };

  it("opens the same card the rail's tiles do, offering the way in", () => {
    bar({ tabs: true, onSelectServer: () => {} });
    fireEvent.mouseEnter(tabOf("Kumo"));
    const card = screen.getByTestId("nebula-server-rail-card");
    expect(card.getAttribute("aria-label")).toBe("Kumo");
    expect(screen.getByRole("button", { name: "Connect to Kumo" })).toBeTruthy();
  });

  it("says who is around you on the server you are on", () => {
    bar({
      tabs: true,
      activeChannelName: "Gaming",
      ownName: "Zewi",
      occupants: [{ session: 1, name: "Sebi", talking: false, muted: false }],
    });
    fireEvent.mouseEnter(tabOf("Magical Rocks"));
    expect(screen.getByText("YOU’RE IN #GAMING AS ZEWI")).toBeTruthy();
    expect(screen.getByText("Sebi")).toBeTruthy();
    // The channel is on this server, not on the other one.
    fireEvent.mouseEnter(tabOf("Kumo"));
    expect(screen.queryByText("Sebi")).toBeNull();
  });

  it("closes a beat after the pointer leaves, so it can be crossed to", () => {
    vi.useFakeTimers();
    try {
      bar({ tabs: true });
      fireEvent.mouseEnter(tabOf("Kumo"));
      fireEvent.mouseLeave(tabOf("Kumo"));
      expect(screen.getByTestId("nebula-server-rail-card")).toBeTruthy();
      fireEvent.mouseEnter(screen.getByTestId("nebula-server-rail-card"));
      act(() => vi.advanceTimersByTime(500));
      expect(screen.getByTestId("nebula-server-rail-card")).toBeTruthy();
      fireEvent.mouseLeave(screen.getByTestId("nebula-server-rail-card"));
      act(() => vi.advanceTimersByTime(500));
      expect(screen.queryByTestId("nebula-server-rail-card")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("picks the server from the card, and the card goes with it", () => {
    const onSelectServer = vi.fn();
    bar({ tabs: true, onSelectServer });
    fireEvent.mouseEnter(tabOf("Kumo"));
    fireEvent.click(screen.getByRole("button", { name: "Connect to Kumo" }));
    expect(onSelectServer).toHaveBeenCalledWith(
      expect.objectContaining({ group: expect.objectContaining({ label: "Kumo" }) }),
    );
    expect(screen.queryByTestId("nebula-server-rail-card")).toBeNull();
  });
});

describe("the title bar with the strip off", () => {
  it("names the server you are on and nothing else", () => {
    bar({ serverLabel: "Magical Rocks" });
    expect(screen.getByText("Magical Rocks")).toBeTruthy();
    // The other servers belong to the rail now, not up here.
    expect(screen.queryByText("Kumo")).toBeNull();
  });

  it("draws the name as a label, not as a tab with a close button", () => {
    bar({ serverLabel: "Magical Rocks", onDisconnect: () => {} });
    expect(screen.queryByLabelText("Disconnect from Magical Rocks")).toBeNull();
    expect(screen.queryByText("✕")).toBeNull();
  });

  it("says nothing while disconnected", () => {
    bar({});
    expect(screen.queryByText("Magical Rocks")).toBeNull();
  });
});

describe("quick connect", () => {
  it("is there when the title bar is the only place servers are listed", () => {
    bar({ tabs: true, onQuickConnect: () => {} });
    expect(screen.getByLabelText("Quick connect")).toBeTruthy();
  });

  it("is gone when the rail is on screen, which has its own add button", () => {
    bar({ serverLabel: "Magical Rocks" });
    expect(screen.queryByLabelText("Quick connect")).toBeNull();
  });
});
