import { afterEach, describe, expect, it, vi } from "vitest";
import type { AclGroup } from "@core/types";
import { primaryRoles, roleColorsByUser, safeRoleColor } from "./roles";

const group = (name: string, color: string | null, add: number[], extra: Partial<AclGroup> = {}): AclGroup =>
  ({ name, color, add, remove: [], inherited_members: [], ...extra }) as unknown as AclGroup;

describe("role colours", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("refuses what could escape a style declaration", () => {
    expect(safeRoleColor("#5865f2")).toBe("#5865f2");
    expect(safeRoleColor("  red ")).toBe("red");
    expect(safeRoleColor("red; background: url(x)")).toBeNull();
    expect(safeRoleColor("")).toBeNull();
    expect(safeRoleColor(null)).toBeNull();
  });

  it("refuses what the runtime says is not a colour", () => {
    vi.stubGlobal("CSS", { supports: (_prop: string, value: string) => value !== "#5865f" });
    expect(safeRoleColor("#5865f")).toBeNull();
    expect(safeRoleColor("#5865f2")).toBe("#5865f2");
  });

  it("colours a name by the first coloured group that holds them", () => {
    const colors = roleColorsByUser([
      group("~sub", "#111111", [1]),
      group("Plain", null, [1, 2]),
      group("Mods", "#ed4245", [1], { remove: [] }),
      group("Crew", "#3ba55d", [1, 2, 3], { remove: [3] }),
    ]);
    expect(colors.get(1)).toBe("#ed4245");
    expect(colors.get(2)).toBe("#3ba55d");
    expect(colors.has(3)).toBe(false);
  });

  it("drops an unsafe colour from a roster heading too", () => {
    const { colors } = primaryRoles([group("Mods", "red;}", [1])]);
    expect(colors.has("Mods")).toBe(false);
  });
});
