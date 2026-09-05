/**
 * Which role a member is listed under.
 *
 * A Mumble server has no notion of a "primary" role: a user is simply in every
 * ACL group that names them. A roster has to pick one anyway - a person filed
 * under four headings is four people as far as a reader scanning the list is
 * concerned - so it picks the first in ACL order, which is the order the server
 * operator put them in.
 *
 * Both member lists need exactly that, so it lives here rather than inside one
 * pack's.
 */

import type { AclGroup } from "@core/types";

export interface PrimaryRoles {
  /** `user_id` to the name of the first role in ACL order they belong to. */
  readonly roleOf: ReadonlyMap<number, string>;
  /** Role names in ACL order, limited to the ones that took a member. */
  readonly order: readonly string[];
  /** The colour the server gave a role, for the ones it gave one. */
  readonly colors: ReadonlyMap<string, string>;
}

/**
 * File every registered user under one role.
 *
 * Groups whose name starts with `~` are Mumble's own bookkeeping rather than
 * something a server operator named, so they never head a section. A user the
 * group explicitly removes is not in it, however they got there - an inherited
 * membership that was revoked here is still revoked.
 */
export function primaryRoles(groups: readonly AclGroup[]): PrimaryRoles {
  const roleOf = new Map<number, string>();
  const order: string[] = [];
  const colors = new Map<string, string>();

  for (const group of groups) {
    if (group.name.startsWith("~")) continue;
    if (group.color && !colors.has(group.name)) colors.set(group.name, group.color);

    const removed = new Set(group.remove);
    let took = false;
    for (const userId of [...group.add, ...group.inherited_members]) {
      if (removed.has(userId)) continue;
      if (roleOf.has(userId)) continue;
      roleOf.set(userId, group.name);
      took = true;
    }
    if (took && !order.includes(group.name)) order.push(group.name);
  }

  return { roleOf, order, colors };
}

/**
 * Every role a user is in, not just the one a roster files them under.
 *
 * `primaryRoles` answers "where does this person go in a list", which is one
 * heading each. Being @-mentioned is the other question - a mention of any
 * group you are in is a mention of you - so it needs the whole set.
 *
 * Membership is read the same way in both: `add` plus what was inherited,
 * minus anyone the group explicitly removes. `~` groups are kept here, unlike
 * in the roster: they are Mumble's own bookkeeping and make poor section
 * headings, but a server that mentions one still means the people in it.
 */
export function rolesForUser(
  groups: readonly AclGroup[],
  userId: number | null | undefined,
): ReadonlySet<string> {
  const mine = new Set<string>();
  if (userId == null) return mine;
  for (const group of groups) {
    if (group.remove.includes(userId)) continue;
    if (group.add.includes(userId) || group.inherited_members.includes(userId)) mine.add(group.name);
  }
  return mine;
}

