import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SavedServer } from "@core/types";
import ServerRail from "./ServerRail";

const server: SavedServer = {
  id: "magical-rocks",
  label: "Magical Rocks",
  host: "magical.rocks",
  port: 64738,
  username: "MyUser",
  cert_label: null,
};

describe("ServerRail", () => {
  it("keeps all detailed server information available in the expanded rail", () => {
    render(<ServerRail items={[server]} expanded activeId={server.id} label="Connected servers" onToggle={vi.fn()} onSelect={vi.fn()} onAdd={vi.fn()} />);
    expect(screen.getByRole("complementary", { name: "Connected servers" })).toBeTruthy();
    expect(screen.getByText("Magical Rocks")).toBeTruthy();
    expect(screen.getByText("magical.rocks:64738")).toBeTruthy();
    expect(screen.getByText("MyUser")).toBeTruthy();
  });

  it("composes selection and add actions through accessible buttons", () => {
    const onSelect = vi.fn();
    const onAdd = vi.fn();
    render(<ServerRail items={[server]} expanded={false} label="Servers" onToggle={vi.fn()} onSelect={onSelect} onAdd={onAdd} />);
    fireEvent.click(screen.getByRole("button", { name: /Magical Rocks/i }));
    fireEvent.click(screen.getByRole("button", { name: /Add server/i }));
    expect(onSelect).toHaveBeenCalledWith(server);
    expect(onAdd).toHaveBeenCalledOnce();
  });
});
