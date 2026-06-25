/**
 * Pure (React-free) model helpers for the Channels / ACL admin view, kept here
 * so they can be unit-tested without rendering.
 */
import type { AclEntry, AclGroup, ChannelEntry } from "../../types";
import { PERM_ENTER } from "../../utils/permissions";

export interface TreeNode {
  channel: ChannelEntry;
  children: TreeNode[];
}

/**
 * Build the channel tree for the ACL view.  The normal tree hangs off the root
 * channel; detached/private channels (meeting rooms, friend DM channels, ...)
 * are parentless and never appear in the regular tree, so they are appended as
 * additional top-level nodes - an admin still needs to manage their ACLs.
 */
export function buildChannelTree(channels: ChannelEntry[]): TreeNode[] {
  const root = channels.find(
    (c) => !c.detached && (c.parent_id === null || c.parent_id === c.id),
  );

  const byParent = new Map<number, ChannelEntry[]>();
  for (const ch of channels) {
    if (ch.detached) continue;
    if (root && ch.id === root.id) continue;
    const pid = ch.parent_id ?? (root ? root.id : -1);
    const list = byParent.get(pid);
    if (list) list.push(ch);
    else byParent.set(pid, [ch]);
  }

  const build = (ch: ChannelEntry): TreeNode => {
    const kids = (byParent.get(ch.id) ?? [])
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
    return { channel: ch, children: kids.map(build) };
  };

  const nodes: TreeNode[] = [];
  if (root) nodes.push(build(root));

  const detached = channels
    .filter((c) => c.detached && (!root || c.id !== root.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const ch of detached) nodes.push({ channel: ch, children: [] });

  return nodes;
}

export interface ChannelAccess {
  /** User ids explicitly granted Enter (deny cancels a grant). */
  granted: number[];
  /** `@all` grants Enter -> everyone can enter. */
  allUsers: boolean;
  /** `@auth` grants Enter -> all registered users can enter. */
  allRegistered: boolean;
  /** Named groups that grant Enter, mapped to their effective member ids. */
  groupMembers: Map<string, number[]>;
}

/**
 * Derive who can enter a channel from its ACL entries. Per-user Enter grants are
 * how private/detached channels admit their members; `@all` / `@auth` and named
 * groups are summarised separately.
 */
export function computeChannelAccess(acls: AclEntry[], groups: AclGroup[]): ChannelAccess {
  const granted = new Set<number>();
  let allUsers = false;
  let allRegistered = false;
  const groupNames = new Set<string>();
  for (const a of acls) {
    const grantsEnter = (a.grant & PERM_ENTER) !== 0;
    const deniesEnter = (a.deny & PERM_ENTER) !== 0;
    if (a.user_id != null) {
      if (deniesEnter) granted.delete(a.user_id);
      else if (grantsEnter) granted.add(a.user_id);
    } else if (a.group && grantsEnter) {
      if (a.group === "all") allUsers = true;
      else if (a.group === "auth") allRegistered = true;
      else groupNames.add(a.group);
    }
  }

  const groupMembers = new Map<string, number[]>();
  for (const name of groupNames) {
    const g = groups.find((gr) => gr.name === name);
    const members = new Set<number>([
      ...(g?.inherited_members ?? []),
      ...(g?.add ?? []),
    ]);
    for (const r of g?.remove ?? []) members.delete(r);
    groupMembers.set(name, [...members]);
  }

  return { granted: [...granted], allUsers, allRegistered, groupMembers };
}
