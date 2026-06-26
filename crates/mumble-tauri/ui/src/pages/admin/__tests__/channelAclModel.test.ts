import { describe, it, expect } from "vitest";
import { buildChannelTree, computeChannelAccess } from "../channelAclModel";
import type { AclEntry, AclGroup, ChannelEntry } from "../../../types";
import { PERM_ENTER, PERM_SPEAK } from "../../../utils/permissions";

function chan(partial: Partial<ChannelEntry> & { id: number }): ChannelEntry {
  return {
    parent_id: 0,
    name: `c${partial.id}`,
    description_size: null,
    user_count: 0,
    permissions: null,
    temporary: false,
    position: 0,
    max_users: 0,
    ...partial,
  };
}

function acl(partial: Partial<AclEntry>): AclEntry {
  return {
    apply_here: true,
    apply_subs: true,
    inherited: false,
    grant: 0,
    deny: 0,
    ...partial,
  };
}

function group(partial: Partial<AclGroup> & { name: string }): AclGroup {
  return {
    inherited: false,
    inherit: true,
    inheritable: true,
    add: [],
    remove: [],
    inherited_members: [],
    ...partial,
  };
}

describe("buildChannelTree", () => {
  it("builds the normal tree off the root channel", () => {
    const tree = buildChannelTree([
      chan({ id: 0, parent_id: null, name: "Root" }),
      chan({ id: 1, parent_id: 0, name: "Lobby" }),
      chan({ id: 2, parent_id: 1, name: "Sub" }),
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0].channel.name).toBe("Root");
    expect(tree[0].children.map((c) => c.channel.name)).toEqual(["Lobby"]);
    expect(tree[0].children[0].children.map((c) => c.channel.name)).toEqual(["Sub"]);
  });

  it("appends detached/private channels as additional top-level nodes", () => {
    const tree = buildChannelTree([
      chan({ id: 0, parent_id: null, name: "Root" }),
      chan({ id: 1, parent_id: 0, name: "Lobby" }),
      // Detached channels are self-parented (parent_id === id) and never appear
      // in the normal tree - they must still show up here.
      chan({ id: 5, parent_id: 5, name: "__dm:1-2", detached: true }),
      chan({ id: 6, parent_id: 6, name: "Standup", detached: true }),
    ]);
    expect(tree).toHaveLength(3);
    expect(tree[0].channel.name).toBe("Root");
    // Detached nodes appear at depth 0 with no children (order is locale-sorted).
    const detachedNames = tree.slice(1).map((n) => n.channel.name);
    expect(detachedNames).toHaveLength(2);
    expect(detachedNames).toContain("Standup");
    expect(detachedNames).toContain("__dm:1-2");
    expect(tree[1].children).toEqual([]);
  });

  it("still lists detached channels even when there is no root", () => {
    const tree = buildChannelTree([
      chan({ id: 7, parent_id: 7, name: "Private", detached: true }),
    ]);
    expect(tree.map((n) => n.channel.name)).toEqual(["Private"]);
  });
});

describe("computeChannelAccess", () => {
  it("collects per-user Enter grants", () => {
    const access = computeChannelAccess(
      [
        acl({ user_id: 3, grant: PERM_ENTER }),
        acl({ user_id: 4, grant: PERM_ENTER | PERM_SPEAK }),
        acl({ user_id: 5, grant: PERM_SPEAK }), // speak only -> no access
      ],
      [],
    );
    expect(access.granted.sort()).toEqual([3, 4]);
    expect(access.allUsers).toBe(false);
    expect(access.allRegistered).toBe(false);
  });

  it("lets a deny entry cancel a grant", () => {
    const access = computeChannelAccess(
      [
        acl({ user_id: 3, grant: PERM_ENTER }),
        acl({ user_id: 3, deny: PERM_ENTER }),
      ],
      [],
    );
    expect(access.granted).toEqual([]);
  });

  it("flags @all and @auth Enter grants", () => {
    expect(computeChannelAccess([acl({ group: "all", grant: PERM_ENTER })], []).allUsers).toBe(true);
    expect(
      computeChannelAccess([acl({ group: "auth", grant: PERM_ENTER })], []).allRegistered,
    ).toBe(true);
  });

  it("resolves the members of a granting group", () => {
    const access = computeChannelAccess(
      [acl({ group: "mods", grant: PERM_ENTER })],
      [group({ name: "mods", inherited_members: [1], add: [2, 3], remove: [3] })],
    );
    expect(access.groupMembers.get("mods")?.sort()).toEqual([1, 2]);
  });
});
