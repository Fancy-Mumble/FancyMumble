import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { withNebulaTheme } from "../../testTheme";
import { RoleChip } from "./RoleChip";

describe("RoleChip", () => {
  afterEach(cleanup);

  // A server stores whatever an admin typed into any client's picker; MUI's
  // `alpha()` threw on the first two, which took down every list naming the role.
  it.each(["red", "#5865f", "#58", "hsl(200 50% 50%)", "#5865f2"])("draws a role coloured %s without throwing", (color) => {
    render(withNebulaTheme(<RoleChip name="Mods" color={color} />));
    expect(screen.getByText("Mods")).toBeTruthy();
  });

  it("draws a colour that could escape its style as an uncoloured chip", () => {
    render(withNebulaTheme(<RoleChip name="Mods" color="red; background: url(x)" />));
    expect(screen.getByText("Mods")).toBeTruthy();
  });
});
