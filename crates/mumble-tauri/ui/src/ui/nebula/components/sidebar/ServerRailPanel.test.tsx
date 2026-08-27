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
});
