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

  it("reorders the rail when a tile is carried past another", () => {
    const onReorder = vi.fn();
    rail({ onReorder });
    const [first] = screen.getAllByRole("button", { name: /magical.rocks|voice.kumo.gg/ });
    fireEvent.pointerDown(first, { button: 0, clientY: 100 });
    // jsdom gives every tile a zero-sized box, so any downward travel reads as
    // past the last one - the end of the rail.
    fireEvent.pointerMove(window, { clientY: 300 });
    fireEvent.pointerUp(window, { clientY: 300 });
    expect(onReorder).toHaveBeenCalledWith(["voice.kumo.gg:64738", "magical.rocks:64738"]);
  });

  it("hands the column to the open list when it is pinned", () => {
    // Tiles beside rows would be the same servers twice - the duplication the
    // merge exists to end.
    rail({ pinned: true });
    expect(screen.queryByTestId("nebula-server-rail")).toBeNull();
    const panel = screen.getByTestId("nebula-server-rail-panel");
    expect(panel.textContent).toContain("magical.rocks");
    expect(panel.textContent).toContain("voice.kumo.gg");
  });

  it("still carries a row to a new place when it is pinned", () => {
    const onReorder = vi.fn();
    rail({ pinned: true, onReorder });
    fireEvent.pointerDown(screen.getByRole("button", { name: /magical.rocks/ }), {
      button: 0,
      clientY: 100,
    });
    fireEvent.pointerMove(window, { clientY: 300 });
    fireEvent.pointerUp(window, { clientY: 300 });
    expect(onReorder).toHaveBeenCalledWith(["voice.kumo.gg:64738", "magical.rocks:64738"]);
  });

  it("narrows the pinned rows without emptying the rail", () => {
    // The search filters what is listed, not where the tiles are: a rail that
    // vanished as you typed would stop being a fixed place to aim at.
    const filtered = [entry("voice.kumo.gg", "saved")];
    rail({ panelEntries: filtered, expanded: true });
    expect(screen.getByTestId("nebula-server-rail-panel").textContent).not.toContain("magical.rocks");
    expect(screen.getByRole("button", { name: /magical.rocks/ })).toBeTruthy();
  });

  it("treats a press that never moved as a click, not a drag", () => {
    const onReorder = vi.fn();
    const onSelect = vi.fn();
    rail({ onReorder, onSelect });
    const [first] = screen.getAllByRole("button", { name: /magical.rocks/ });
    fireEvent.pointerDown(first, { button: 0, clientY: 100 });
    fireEvent.pointerUp(window, { clientY: 100 });
    fireEvent.click(first);
    expect(onReorder).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalled();
  });
});
