import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { withNebulaTheme } from "../../testTheme";
import type { ServerRailEntry, ServerRailStatus } from "../../selectors";
import { ServerRail } from "./ServerRail";

vi.mock("@core/lazyBlobs", () => ({ useUserAvatar: () => null }));

const entry = (host: string, status: ServerRailStatus, unread = 0): ServerRailEntry => ({
  group: {
    key: host + ":64738",
    label: host,
    host,
    port: 64738,
    identities: [],
    favorite: false,
    sessionId: status === "saved" ? null : "s-" + host,
  },
  session: null,
  status,
  unread,
});

const rail = (props: Partial<Parameters<typeof ServerRail>[0]> = {}) =>
  render(
    withNebulaTheme(
      <ServerRail
        entries={[entry("magical.rocks", "connected", 12), entry("voice.kumo.gg", "saved")]}
        activeKey="magical.rocks:64738"
        expanded={false}
        onToggleExpanded={() => {}}
        onSelect={() => {}}
        onAddServer={() => {}}
        {...props}
      />,
    ),
  );
describe("ServerRail", () => {
  it("says which server is open and how each one is doing", () => {
    rail();
    const open = screen.getByRole("button", { name: /magical.rocks, connected, 12 unread/ });
    expect(open.getAttribute("aria-current")).toBe("true");
    const idle = screen.getByRole("button", { name: /voice.kumo.gg, not connected/ });
    expect(idle.getAttribute("aria-current")).toBeNull();
  });

  it("caps the unread count so three digits cannot widen a tile", () => {
    rail({ entries: [entry("magical.rocks", "connected", 250)] });
    expect(screen.getByText("99+")).toBeTruthy();
  });

  it("keeps a tile for a server nobody is connected to", () => {
    // The rail is the way in to a saved server, not only a switcher between
    // the ones already open.
    rail({ entries: [entry("voice.kumo.gg", "saved")] });
    expect(screen.getByRole("button", { name: /voice.kumo.gg/ })).toBeTruthy();
  });

  it("offers nothing to disconnect from while nothing is connected", () => {
    rail();
    expect(screen.queryByRole("button", { name: /Disconnect/ })).toBeNull();
  });

  it("opens the server it was asked for", () => {
    const onSelect = vi.fn();
    rail({ onSelect });
    fireEvent.click(screen.getByRole("button", { name: /voice.kumo.gg/ }));
    expect(onSelect.mock.calls[0][0].group.host).toBe("voice.kumo.gg");
  });

  it("reorders the rail when a tile is dropped past another", () => {
    const onReorder = vi.fn();
    rail({ onReorder });
    const [first, second] = screen.getAllByRole("button", { name: /magical.rocks|voice.kumo.gg/ });
    fireEvent.dragStart(first, { dataTransfer: { setData: () => {}, effectAllowed: "" } });
    // jsdom drag events carry no pointer position, so this reads as the lower
    // half of the last tile - the end of the rail.
    fireEvent.dragOver(second, { dataTransfer: { dropEffect: "" } });
    fireEvent.drop(second);
    expect(onReorder).toHaveBeenCalledWith(["voice.kumo.gg:64738", "magical.rocks:64738"]);
  });
});
