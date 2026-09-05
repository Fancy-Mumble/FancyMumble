import { describe, expect, it } from "vitest";
import type { AclGroup } from "@core/types";
import { rolesForUser } from "./roles";

const group = (name: string, partial: Partial<AclGroup> = {}): AclGroup =>
  ({
    name,
    inherited: false,
    inherit: true,
    inheritable: true,
    add: [],
    remove: [],
    inherited_members: [],
    ...partial,
  }) as AclGroup;

describe("rolesForUser", () => {
  it("collects every group naming the user, not just the first", () => {
    const groups = [group("Admins", { add: [7] }), group("Moderators", { add: [7, 9] })];
    expect([...rolesForUser(groups, 7)].sort()).toEqual(["Admins", "Moderators"]);
  });

  it("counts an inherited membership", () => {
    expect([...rolesForUser([group("Staff", { inherited_members: [7] })], 7)]).toEqual(["Staff"]);
  });

  it("honours an explicit removal, however the membership arrived", () => {
    const groups = [group("Staff", { add: [7], inherited_members: [7], remove: [7] })];
    expect([...rolesForUser(groups, 7)]).toEqual([]);
  });

  it("keeps Mumble's own ~ groups, which a roster heading would drop", () => {
    expect([...rolesForUser([group("~admin", { add: [7] })], 7)]).toEqual(["~admin"]);
  });

  it("is empty for an unregistered user, who has no id to match", () => {
    expect(rolesForUser([group("Admins", { add: [7] })], null).size).toBe(0);
    expect(rolesForUser([group("Admins", { add: [7] })], undefined).size).toBe(0);
  });

  it("is empty when the ACL could not be read at all", () => {
    expect(rolesForUser([], 7).size).toBe(0);
  });
});
