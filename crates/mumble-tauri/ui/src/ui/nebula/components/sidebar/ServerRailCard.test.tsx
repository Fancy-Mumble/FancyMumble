import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { withNebulaTheme } from "../../testTheme";
import type { ServerRailEntry, ServerRailStatus } from "../../selectors";
import { ServerRailCard } from "./ServerRailCard";

vi.mock("@core/lazyBlobs", () => ({ useUserAvatar: () => null }));

const entry = (host: string, status: ServerRailStatus, unread = 0, identities = 0): ServerRailEntry => ({
  group: {
    key: host + ":64738",
    label: host,
    host,
    port: 64738,
    identities: Array.from({ length: identities }, () => ({}) as never),
    favorite: false,
    sessionId: status === "saved" ? null : "s",
  },
  session: status === "saved" ? null : ({ id: "s", host, port: 64738, username: "Zewi" } as never),
  status,
  unread,
});

const card = (props: Partial<Parameters<typeof ServerRailCard>[0]>) =>
  render(
    withNebulaTheme(
      <ServerRailCard
        entry={entry("magical.rocks", "connected")}
        ping={{ online: true, user_count: 3, max_user_count: 101, latency_ms: 18 } as never}
        top={0}
        onOpen={() => {}}
        onPointerEnter={() => {}}
        onPointerLeave={() => {}}
        {...props}
      />,
    ),
  );

describe("ServerRailCard", () => {
  it("says who is around you on the server you are on", () => {
    card({
      channelName: "Gaming",
      ownName: "Zewi",
      occupants: [{ session: 1, name: "Sebi", talking: true, muted: false }],
    });
    expect(screen.getByText("YOU’RE IN #GAMING AS ZEWI")).toBeTruthy();
    expect(screen.getByText("speaking")).toBeTruthy();
    expect(screen.getByText("3/101 online")).toBeTruthy();
  });

  it("offers the way in for a server you are not on", () => {
    card({ entry: entry("kumo.jp", "saved", 12, 2) });
    expect(screen.getByRole("button", { name: "Connect to kumo.jp" })).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
  });

  it("says only how far it has got while a server is being reached", () => {
    // Occupancy and latency are not known yet, so the card shows neither.
    card({ entry: entry("localhost", "connecting"), onCancel: () => {} });
    expect(screen.getByText("Handshaking with the server…")).toBeTruthy();
    expect(screen.queryByText("3/101 online")).toBeNull();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });
});
