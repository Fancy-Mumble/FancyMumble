/**
 * What a profile card is told about a person.
 *
 * The card paints; it never fetches. Each host - the client from its Mumble
 * session, the channel viewer from its REST feed - fills this record with what
 * it actually knows, and anything it does not know it leaves out, which is what
 * lets one component serve a hover preview, a full card and a settings preview
 * without three sets of rules about which rows exist.
 */
import type { BadgeGlyphName } from "./icons";
import { isBadgeGlyphName } from "./icons";
import type { FancyProfile, ProfileSections } from "./profileTypes";

/** What is drawn inside a badge chip or on a shelf node. */
export type BadgeGlyph =
  { kind: "icon"; name: BadgeGlyphName } | { kind: "text"; text: string } | { kind: "image"; src: string };

/**
 * Where a badge came from.
 *
 * The distinction is not cosmetic: `state` badges are live voice flags the
 * server just sent and are true for exactly as long as they are shown, while
 * `group` and `server` badges are things the server has granted the person.
 * Hosts sort on it so a transient mute never pushes a granted badge out of the
 * visible strip.
 */
export type BadgeSource = "group" | "server" | "state";

export interface ProfileBadge {
  id: string;
  /** Read out on hover, and the accessible name of the chip. */
  label: string;
  glyph: BadgeGlyph;
  /** Accent colour; the chip tints its fill and its glyph from this. */
  tone?: string;
  source: BadgeSource;
  /** Shelf this badge belongs on. Absent keeps it in the strip under the name. */
  shelf?: string;
  /** What that shelf is called. The first badge on it that names one wins. */
  shelfLabel?: string;
  /** Node shape on a shelf. Defaults to a dot. */
  shape?: "dot" | "diamond";
}

/**
 * One rail of badges under the activity row.
 *
 * The mock draws badges twice over, and deliberately: the strip under the name
 * is the four the person leads with, and the shelves below are the collection
 * they came out of, one rail per tier, each ending in a count of what did not
 * fit.
 */
export interface BadgeShelf {
  id: string;
  /** Centred caps label between the nodes. The first shelf usually has none. */
  label?: string;
  badges: ProfileBadge[];
  /** Owned on this shelf but not drawn. */
  overflow: number;
}

/** A server group the person is in, drawn as a chip. */
export interface ProfileRole {
  id: string;
  name: string;
  color?: string | null;
}

/** The row above the badge shelves: a game, or simply being in a channel. */
export interface CardActivity {
  /** "Playing League of Legends", "In voice - Gaming". */
  title: string;
  /** "ARAM · 24 min", "48 min · talking". */
  detail?: string;
  /** Artwork; a hatched tile stands in when there is none. */
  image?: string | null;
  /** The link the mock ends the detail line with. */
  action?: { label: string; onClick: () => void };
}

/** One figure in the three-up row: "1.2k / Messages". */
export interface CardStat {
  id: string;
  value: string;
  label: string;
}

export type PresenceTone = "online" | "talking" | "muted" | "deafened" | "offline";

/** The pill in the banner's top-left corner. */
export interface CardPresence {
  tone: PresenceTone;
  label: string;
}

/** Everything a card can draw about one person. */
export interface ProfileCardModel {
  name: string;
  /** Stable key the assigned colour is hashed from - a cert hash, or the name. */
  tintKey: string;
  avatar?: string | null;
  /** The stored customisation, or null for someone who has set none. */
  profile: FancyProfile | null;
  /**
   * The visible part of the comment, as the formatted text it is written in.
   *
   * Handed over as markup rather than as stripped text: the card renders it
   * through `richText`, which builds elements from an allow-list rather than
   * trusting the string, so a host neither has to sanitise it first nor is
   * able to lose the user's formatting by flattening it.
   */
  bio: string;
  presence: CardPresence;
  /** The tick beside the name: a registered account rather than a guest. */
  verified?: boolean;
  badges: ProfileBadge[];
  shelves: BadgeShelf[];
  roles: ProfileRole[];
  /** Servers both people are on. Null when the host cannot know. */
  mutualServers?: number | null;
  activity?: CardActivity | null;
  stats: CardStat[];
}

/** How many badge chips fit under the name before the rest become "+N". */
export const BADGE_STRIP_LIMIT = 4;
/** How many nodes fit on one shelf rail before the rest become "+N". */
export const SHELF_NODE_LIMIT = 3;

/**
 * A server group, as much of one as the card needs.
 *
 * Structural rather than imported so both hosts can pass their own record:
 * the client's `AclGroup` and anything the channel viewer's API grows.
 */
export interface ProfileGroupSource {
  name: string;
  color?: string | null;
  /** Free-form key/value metadata the server attaches to the group. */
  metadata?: Record<string, string>;
}

/** The live voice flags a badge can be minted from. */
export interface UserStateFlags {
  registered?: boolean;
  prioritySpeaker?: boolean;
  muted?: boolean;
  deafened?: boolean;
}

function truthy(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

/**
 * Turn one server group into the badge it grants.
 *
 * Groups already travel with a colour and free-form metadata, which is the
 * opening the server-managed badge catalogue will arrive through: today a group
 * with no badge metadata still yields a sensible chip, and a server that starts
 * naming glyphs, shelves and shapes gets them without a client release.
 */
export function badgeFromGroup(group: ProfileGroupSource): ProfileBadge | null {
  const meta = group.metadata ?? {};
  if (truthy(meta.badge_hidden)) return null;
  const iconName = meta.badge_icon;
  const glyph: BadgeGlyph =
    iconName && isBadgeGlyphName(iconName)
      ? { kind: "icon", name: iconName }
      : meta.badge_emoji
        ? { kind: "text", text: meta.badge_emoji }
        : { kind: "text", text: group.name.slice(0, 1).toUpperCase() };
  return {
    id: `group:${group.name}`,
    label: meta.badge_label ?? group.name,
    glyph,
    tone: meta.badge_color ?? group.color ?? undefined,
    source: "group",
    shelf: meta.badge_shelf,
    shelfLabel: meta.badge_shelf_label,
    shape: meta.badge_shape === "diamond" ? "diamond" : "dot",
  };
}

/** The badges that are simply true right now, rather than granted. */
export function badgesFromState(flags: UserStateFlags, tone: Record<string, string>): ProfileBadge[] {
  const badges: ProfileBadge[] = [];
  if (flags.prioritySpeaker)
    badges.push({
      id: "state:priority",
      label: "Priority speaker",
      glyph: { kind: "icon", name: "star" },
      tone: tone.warn,
      source: "state",
    });
  if (flags.muted)
    badges.push({
      id: "state:muted",
      label: "Muted",
      glyph: { kind: "icon", name: "mic-off" },
      tone: tone.bad,
      source: "state",
    });
  if (flags.deafened)
    badges.push({
      id: "state:deafened",
      label: "Deafened",
      glyph: { kind: "icon", name: "headphones-off" },
      tone: tone.bad,
      source: "state",
    });
  return badges;
}

/**
 * Split a person's badges into the strip under their name and the shelves below.
 *
 * Granted badges lead: a mute that lasts thirty seconds must not push a role
 * out of the four chips anyone actually looks at. Whatever does not fit is
 * counted rather than dropped, on the strip and on every shelf, because a
 * collection that silently truncates reads as a smaller collection.
 */
export function arrangeBadges(
  badges: readonly ProfileBadge[],
  shelfLabels: Readonly<Record<string, string>> = {},
): { strip: ProfileBadge[]; stripOverflow: number; shelves: BadgeShelf[] } {
  const rank: Record<BadgeSource, number> = { group: 0, server: 1, state: 2 };
  const ordered = [...badges].sort((left, right) => rank[left.source] - rank[right.source]);
  const strip = ordered.slice(0, BADGE_STRIP_LIMIT);

  const byShelf = new Map<string, ProfileBadge[]>();
  for (const badge of ordered) {
    if (badge.shelf === undefined) continue;
    const existing = byShelf.get(badge.shelf);
    if (existing) existing.push(badge);
    else byShelf.set(badge.shelf, [badge]);
  }

  const shelves: BadgeShelf[] = [...byShelf.entries()].map(([id, members]) => ({
    id,
    label: shelfLabelOf(id, members, shelfLabels),
    badges: members.slice(0, SHELF_NODE_LIMIT),
    overflow: Math.max(0, members.length - SHELF_NODE_LIMIT),
  }));

  return { strip, stripOverflow: Math.max(0, ordered.length - strip.length), shelves };
}

/**
 * What a rail is called.
 *
 * The mock's first rail carries no label and its second says SPECIAL, which is
 * the rule: the default shelf - the one with no id - is the collection itself
 * and needs no name, and a named shelf shows the name the server gave it, or
 * its own id when the server gave none.
 */
function shelfLabelOf(
  id: string,
  members: readonly ProfileBadge[],
  overrides: Readonly<Record<string, string>>,
): string | undefined {
  if (id === "") return undefined;
  const stated = overrides[id] ?? members.find((badge) => badge.shelfLabel)?.shelfLabel;
  return stated ?? id.slice(0, 1).toUpperCase() + id.slice(1);
}

/** Whether an optional row is drawn; absent means yes. See `ProfileSections`. */
export function showsSection(sections: ProfileSections | undefined, key: keyof ProfileSections): boolean {
  return sections?.[key] !== false;
}

/** "1.2k" - the mock's count format, which stops caring past a thousand. */
export function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(Math.round(value));
}

/** "212 h" for a long stretch, "48 min" for a short one. */
export function formatSpan(seconds: number): string {
  if (seconds >= 3600) return `${Math.round(seconds / 3600)} h`;
  if (seconds >= 60) return `${Math.round(seconds / 60)} min`;
  return `${Math.max(0, Math.round(seconds))} s`;
}
