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
    const color = safeRoleColor(group.color);
    if (color && !colors.has(group.name)) colors.set(group.name, color);

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

/**
 * A server-given role colour made safe to put in a style, or null.
 *
 * The colour is whatever the server stored, typed by whoever edits the roles
 * in whichever client. Anything that could escape the declaration it is
 * written into is refused, and - where the runtime can say - so is anything
 * that is not a colour at all, a half-typed `#5865f` included. A refused
 * colour draws the role uncoloured rather than wrong.
 */
export function safeRoleColor(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (value.length === 0 || value.length > 64) return null;
  if (!/^[#A-Za-z0-9 .,()%/]+$/.test(value)) return null;
  if (typeof CSS !== "undefined" && typeof CSS.supports === "function" && !CSS.supports("color", value)) {
    return null;
  }
  return value;
}

/**
 * The colour a member's name is drawn in: that of the first group, in ACL
 * order, that both holds them and has a colour.
 *
 * Not the same pick as {@link primaryRoles}, which files a member under their
 * first group whether or not it is coloured - a list heading needs a name, a
 * name only needs a colour.
 */
export function roleColorsByUser(groups: readonly AclGroup[]): ReadonlyMap<number, string> {
  const byUser = new Map<number, string>();
  for (const group of groups) {
    if (group.name.startsWith("~")) continue;
    const color = safeRoleColor(group.color);
    if (!color) continue;
    const removed = new Set(group.remove);
    for (const userId of [...group.add, ...group.inherited_members]) {
      if (!removed.has(userId) && !byUser.has(userId)) byUser.set(userId, color);
    }
  }
  return byUser;
}
