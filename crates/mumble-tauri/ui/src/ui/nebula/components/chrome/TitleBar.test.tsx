import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
