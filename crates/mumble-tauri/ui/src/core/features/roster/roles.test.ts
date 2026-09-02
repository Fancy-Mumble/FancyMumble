import { describe, expect, it } from "vitest";
import type { AclGroup } from "@core/types";
import { primaryRoles } from "./roles";

function group(partial: Partial<AclGroup> & { name: string }): AclGroup {
  return {
    inherited: false,
    inherit: true,
    inheritable: true,
    add: [],
    remove: [],
    inherited_members: [],
    color: null,
    ...partial,
  };
}

describe("primaryRoles", () => {
  it("files a user under the first role in ACL order that claims them", () => {
    const { roleOf } = primaryRoles([
      group({ name: "admin", add: [10] }),
      group({ name: "mods", add: [10, 20] }),
    ]);
    expect(roleOf.get(10)).toBe("admin");
    expect(roleOf.get(20)).toBe("mods");
  });

  it("counts an inherited membership, and drops one the group revokes", () => {
    const { roleOf } = primaryRoles([
      group({ name: "admin", inherited_members: [10], remove: [10] }),
      group({ name: "mods", inherited_members: [10] }),
    ]);
    expect(roleOf.get(10)).toBe("mods");
  });

  it("orders only the roles that took someone, and keeps their colours", () => {
    const { order, colors } = primaryRoles([
      group({ name: "empty" }),
      group({ name: "admin", add: [10], color: "#41b4f9" }),
    ]);
    expect(order).toEqual(["admin"]);
    expect(colors.get("admin")).toBe("#41b4f9");
  });

  it("never heads a section with Mumble's own bookkeeping groups", () => {
    const { order, roleOf } = primaryRoles([
      group({ name: "~sub", add: [10] }),
      group({ name: "mods", add: [10] }),
    ]);
    expect(order).toEqual(["mods"]);
    expect(roleOf.get(10)).toBe("mods");
  });
});
