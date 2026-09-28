/**
 * Placeholders every greeting can use without anybody wiring anything.
 *
 * A declared input is a *port*: the operator draws a wire to it, and until they
 * do the slot renders empty. That is right for copy the operator supplies and
 * wrong for the handful of facts the server already knows about whoever is
 * connecting - nobody should have to wire a node to say "hello" by name.
 *
 * ## Where this list comes from
 *
 * Not from the mock, which is an email tool's list - `$user.first_name`,
 * `$account.plan`, `$link.unsubscribe`. A Mumble server has no plan and no
 * unsubscribe link, and shipping placeholders it cannot fill would put empty
 * strings in the middle of a greeting on every join.
 *
 * So the list is exactly what the server has at handshake, which is
 * `greeting::Facts` in `starling/crates/runtime/src/greeting.rs` plus its own
 * clock. Every entry below names one field of that struct. Adding one here
 * means adding a fact there first, which is the right order: the design cannot
 * invent what the wire does not carry.
 */

/** The sections the picker and the dock group these under. */
export const BUILT_IN_GROUPS = ["recipient", "time"] as const;
export type BuiltInGroup = (typeof BUILT_IN_GROUPS)[number];

export const BUILT_IN_GROUP_LABELS: Record<BuiltInGroup, string> = {
  recipient: "Recipient",
  time: "Date & time",
};

export interface BuiltIn {
  /** How it is written in the copy, without the `$`. */
  readonly name: string;
  /** What it is, in the picker's second column. */
  readonly about: string;
  /** What it would say for somebody, so the list is readable at a glance. */
  readonly sample: string;
  readonly group: BuiltInGroup;
}

export const BUILT_INS: readonly BuiltIn[] = [
  // -- from `Facts`, one per field
  {
    name: "user.country",
    about: "Country the member connects from",
    sample: "DE",
    group: "recipient",
  },
  { name: "user.os", about: "Operating system the client reports", sample: "Linux", group: "recipient" },
  { name: "user.client", about: "Mumble version the client announces", sample: "1.5.735", group: "recipient" },
  {
    name: "user.fancy",
    about: "Fancy version, or “stock” for an unmodified client",
    sample: "0.4.2",
    group: "recipient",
  },
  {
    name: "user.account",
    about: "Whether they hold a registered account",
    sample: "registered",
    group: "recipient",
  },
  {
    name: "user.cert",
    about: "Whether their certificate chains to a configured CA",
    sample: "trusted",
    group: "recipient",
  },
  { name: "user.groups", about: "ACL groups at the root channel", sample: "admin, moderator", group: "recipient" },
  {
    name: "user.since",
    about: "How long the account has existed here",
    sample: "3 months",
    group: "time",
  },

  // -- from the server's own clock
  { name: "now.date", about: "Send date, in the server's timezone", sample: "4 Sep 2026", group: "time" },
  { name: "now.time", about: "Send time, in the server's timezone", sample: "22:41", group: "time" },
  { name: "now.year", about: "Send year, for a copyright line", sample: "2026", group: "time" },
];

const BY_NAME = new Map(BUILT_INS.map((entry) => [entry.name, entry]));

/**
 * Whether a name is a built-in rather than something the operator declared.
 *
 * The one question every other module asks about these: a built-in is always
 * wired, never appears in the design's own `slots`, and must not be reported as
 * a dangling reference just because it is not declared.
 */
export function isBuiltIn(name: string): boolean {
  return BY_NAME.has(name);
}

export function builtIn(name: string): BuiltIn | undefined {
  return BY_NAME.get(name);
}

/** The built-ins of one group, for a sectioned list. */
export function builtInsOf(group: BuiltInGroup): BuiltIn[] {
  return BUILT_INS.filter((entry) => entry.group === group);
}
