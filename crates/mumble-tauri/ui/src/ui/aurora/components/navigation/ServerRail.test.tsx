import type { ComponentProps } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ServerRail, { initials, type RailGroup } from "./ServerRail";

const connected: RailGroup = {
  key: "magical.rocks:64738",
  label: "Magical Rocks",
  host: "magical.rocks",
  port: 64738,
  favorite: true,
  identities: [{ id: "a", label: "Magical Rocks", host: "magical.rocks", port: 64738, username: "MyUser", sessionId: "session-1" }],
};

const shared: RailGroup = {
  key: "localhost:64738",
  label: "localhost",
  host: "localhost",
  port: 64738,
  favorite: false,
  identities: [
    { id: "b", label: "localhost", host: "localhost", port: 64738, username: "Zewi2", sessionId: null },
    { id: "c", label: "localhost", host: "localhost", port: 64738, username: "SuperUser", sessionId: null },
  ],
};

function renderRail(overrides: Partial<ComponentProps<typeof ServerRail>> = {}) {
  const props = {
    groups: [connected, shared],
    expanded: true,
    activeSessionId: "session-1",
    label: "Connected servers",
    onToggle: vi.fn(),
    onSelect: vi.fn(),
    onAdd: vi.fn(),
    ...overrides,
  };
  render(<ServerRail {...props} />);
  return props;
}

describe("ServerRail", () => {
  it("derives readable initials from host-style names", () => {
    expect(initials("magical.rocks")).toBe("MR");
    expect(initials("Magical.Rocks - SuperUser")).toBe("MR");
    expect(initials("localhost")).toBe("L");
  });

  it("keeps detailed server information available in the expanded rail", () => {
    renderRail();
    expect(screen.getByRole("complementary", { name: "Connected servers" })).toBeTruthy();
    expect(screen.getByText("Magical Rocks")).toBeTruthy();
    expect(screen.getByText("magical.rocks:64738")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Collapse server sidebar" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("selects a lone identity directly instead of expanding", () => {
    const { onSelect } = renderRail();
    fireEvent.click(screen.getByTitle("Open Magical Rocks"));
    expect(onSelect).toHaveBeenCalledWith(connected.identities[0]);
  });

  it("collapses several identities on one address into one expandable tile", () => {
    const { onSelect } = renderRail();
    // Both localhost identities start hidden behind the stacked group tile.
    expect(screen.queryByTitle("Connect as Zewi2")).toBeNull();
    expect(screen.getByText("2 identities")).toBeTruthy();

    fireEvent.click(screen.getByTitle("Expand localhost (2 identities)"));
    expect(screen.getByTitle("Connect as Zewi2")).toBeTruthy();

    fireEvent.click(screen.getByTitle("Connect as SuperUser"));
    expect(onSelect).toHaveBeenCalledWith(shared.identities[1]);

    // Clicking the group tile again collapses it.
    fireEvent.click(screen.getByTitle("Collapse localhost (2 identities)"));
    expect(screen.queryByTitle("Connect as Zewi2")).toBeNull();
  });

  it("exposes the add-server action", () => {
    const { onAdd } = renderRail();
    fireEvent.click(screen.getByRole("button", { name: /Add server/i }));
    expect(onAdd).toHaveBeenCalledOnce();
  });
});
