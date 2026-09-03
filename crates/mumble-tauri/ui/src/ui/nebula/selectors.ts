/**
 * Pure derivations behind the Nebula screens.
 *
 * The mock's sidebar is a single indented list with the joined voice channel
 * expanded in place, and its message river is grouped by day - neither shape
 * exists in the store, so both are computed here rather than inside a
 * component body. Keeping them pure means the layout decisions they encode
 * (ordering, indent depth, what counts as "today") are testable on their own.
 */
import type { useTranslation } from "react-i18next";
import { htmlToMarkdown, markdownToHtml } from "@standard/components/chat/markdown/MarkdownInput";
import { bodyToHtml } from "@standard/components/chat/markdown/bodyHtml";
import { hslToHex } from "@core/utils/colorUtils";
import { formatTimestamp } from "@core/utils/format";
import { hueFromKey } from "@shared/profilecard/tint";
import { primaryRoles } from "@core/features/roster/roles";
import type {
  AclGroup,
  ChannelEntry,
  ConnectionStatus,
  KeyHolderEntry,
  SavedServer,
  SearchResult,
  TimeFormat,
  UserEntry,
} from "@core/types";
import {
  PERM_BAN,
  PERM_KICK,
  PERM_MOVE,
  PERM_MUTE_DEAFEN,
  PERM_REGISTER,
  PERM_RESET_USER_CONTENT,
} from "@core/utils/permissions";

export interface OrderedChannel {
  channel: ChannelEntry;
  /** Indent level; root children are 0. */
  depth: number;
}

export interface ChannelFilter {
  channels: readonly ChannelEntry[];
  query: string;
  hideEmpty: boolean;
  currentChannel: number | null;
  selectedChannel: number | null;
}

/**
 * Channels in tree order, with the depth each row should indent by.
 *
 * A channel survives the filter when it matches on its own, and its ancestors
 * are always kept so a deep match never appears detached from its parent.
 */
/**
 * The `t` the label-producing selectors take.
 *
 * They stay pure - the sentence is still decided here and only its wording
 * comes from outside - so their tests need no i18n runtime, just a stub.  The
 * type is derived from the hook so a caller's `t` always fits: everything
 * these functions say lives in `nebulaCommon`.
 */
export type SelectorT = ReturnType<typeof useTranslation<"nebulaCommon">>["t"];

export function orderChannels(input: ChannelFilter): OrderedChannel[] {
  const candidates = input.channels.filter((channel) => !channel.detached);
  const byId = new Map(candidates.map((channel) => [channel.id, channel]));
  const keep = new Set<number>();
  const keepWithAncestors = (channelId: number) => {
    let current = byId.get(channelId);
    while (current && !keep.has(current.id)) {
      keep.add(current.id);
      current = current.parent_id === null ? undefined : byId.get(current.parent_id);
    }
  };

  const needle = input.query.trim().toLocaleLowerCase();
  for (const channel of candidates) {
    const matchesQuery = !needle || channel.name.toLocaleLowerCase().includes(needle);
    const matchesVisibility =
      !input.hideEmpty ||
      channel.user_count > 0 ||
      channel.id === input.currentChannel ||
      channel.id === input.selectedChannel;
    if (matchesQuery && matchesVisibility) keepWithAncestors(channel.id);
  }

  const visible = candidates.filter((channel) => keep.has(channel.id));
  const childrenOf = new Map<number | null, ChannelEntry[]>();
  for (const channel of visible) {
    const siblings = childrenOf.get(channel.parent_id) ?? [];
    siblings.push(channel);
    childrenOf.set(channel.parent_id, siblings);
  }
  for (const siblings of childrenOf.values())
    siblings.sort((left, right) => left.position - right.position || left.name.localeCompare(right.name));

  // The root channel has `parent_id: null`; any other parentless channel would
  // otherwise be dropped, so treat it as a root too.
  const roots = [
    ...(childrenOf.get(null) ?? []),
    ...visible.filter((channel) => channel.parent_id !== null && !byId.has(channel.parent_id)),
  ];
  const ordered: OrderedChannel[] = [];
  const walk = (channel: ChannelEntry, depth: number) => {
    ordered.push({ channel, depth });
    for (const child of childrenOf.get(channel.id) ?? []) walk(child, depth + 1);
  };
  for (const root of roots) walk(root, 0);
  return ordered;
}

/**
 * Who is sitting in one channel, alphabetically.
 *
 * Deliberately not ordered by who is talking: push-to-talk taps would then
 * reshuffle the roster several times a sentence. The avatar ring and the
 * talking bars already say who has the floor without moving anyone.
 */
export function channelOccupants(users: readonly UserEntry[], channelId: number): UserEntry[] {
  return users.filter((user) => user.channel_id === channelId).sort(byName);
}

/**
 * Every channel's occupants at once, keyed by channel.
 *
 * The tree lists members under each channel, so asking `channelOccupants` per
 * row would walk the whole roster once per channel - quadratic on exactly the
 * servers where it hurts, a few hundred channels holding a few hundred people.
 * Channels nobody is in are absent rather than mapped to an empty array.
 */
export function groupOccupants(users: readonly UserEntry[]): ReadonlyMap<number, UserEntry[]> {
  const byChannel = new Map<number, UserEntry[]>();
  for (const user of users) {
    const bucket = byChannel.get(user.channel_id);
    if (bucket) bucket.push(user);
    else byChannel.set(user.channel_id, [user]);
  }
  for (const bucket of byChannel.values()) bucket.sort(byName);
  return byChannel;
}

function byName(left: UserEntry, right: UserEntry) {
  return left.name.localeCompare(right.name);
}

/** A member row: the person, and the two facts a row outside the open channel
 *  states about them - where they are, and whether they are here at all. */
export interface RosterMember {
  user: UserEntry;
  /** The channel they are sitting in; null for someone who is not connected. */
  channel: string | null;
  offline: boolean;
}

/** The kinds of heading the roster draws, in the order they appear. */
export type RosterGroupKind = "channel" | "role" | "members" | "guests";

export interface RosterGroup {
  /** Stable across renders: the role's name, or the kind for the fixed ones. */
  key: string;
  kind: RosterGroupKind;
  /** The role's name. Empty for the three fixed groups, which name themselves. */
  label: string;
  /** The colour the server gave the role, where it gave one. */
  color: string | null;
  members: readonly RosterMember[];
}

export interface RosterInput {
  /** Everyone the server has announced as connected. */
  users: readonly UserEntry[];
  /** Every registered user as an offline row (see `useRegisteredMembers`);
   *  the ones who are connected are dropped here rather than by the caller. */
  registered: readonly UserEntry[];
  /** The root channel's ACL groups - what this server calls its roles. */
  roles: readonly AclGroup[];
  /** Read for the "where are they" column; a name, not an id, is what a row says. */
  channels: readonly ChannelEntry[];
  /** The panel's own search box. */
  query: string;
  /** The channel whose conversation is open: its occupants are the people who
   *  can hear each other, which is what the first section is. */
  selectedChannel: number | null;
  /** Whether the registration table is drawn at all - on a server with
   *  thousands registered it is not a small answer. */
  showOffline: boolean;
}

/** Sentinel keys for the two catch-all buckets at the end of the list. */
const ROSTER_MEMBERS = "__members__";
const ROSTER_GUESTS = "__guests__";

/** Online first, then alphabetical - an absent member is still a member, but
 *  they are not who you are looking for when you open a roster. */
function compareMembers(left: RosterMember, right: RosterMember): number {
  if (left.offline !== right.offline) return left.offline ? 1 : -1;
  return left.user.name.localeCompare(right.user.name);
}

/**
 * The member panel, split into the groups it draws.
 *
 * Two questions, one list. "Who can hear me" is the channel you are reading,
 * and it comes first because it is the one being asked while someone is
 * talking. "Who is this server" is everyone else - and the answer worth
 * reading is not a flat alphabet but the server's own structure, so the rest
 * of the list is its roles in the order the operator put them in, each person
 * under the first role that claims them.
 *
 * People appear twice on purpose: an admin sitting in your channel is both
 * someone you are talking to and the person to ask, and a roster that made you
 * choose which of those to look at would answer neither question.
 *
 * Empty groups are dropped, so a server with no roles configured is a channel
 * section and one "Members" list rather than a column of empty headings.
 */
export function rosterGroups(input: RosterInput): RosterGroup[] {
  const needle = input.query.trim().toLocaleLowerCase();
  const matches = (user: UserEntry) => !needle || user.name.toLocaleLowerCase().includes(needle);
  const channelNames = new Map(input.channels.map((channel) => [channel.id, channel.name]));

  const here: RosterMember[] = [];
  const everyone: RosterMember[] = [];
  const connectedIds = new Set<number>();
  for (const user of input.users) {
    if (user.user_id != null && user.user_id > 0) connectedIds.add(user.user_id);
    if (!matches(user)) continue;
    const member: RosterMember = {
      user,
      channel: channelNames.get(user.channel_id) ?? null,
      offline: false,
    };
    if (input.selectedChannel !== null && user.channel_id === input.selectedChannel) here.push(member);
    everyone.push(member);
  }

  if (input.showOffline) {
    for (const entry of input.registered) {
      if (entry.user_id != null && connectedIds.has(entry.user_id)) continue;
      if (!matches(entry)) continue;
      // No channel: someone who is not connected is nowhere, and the last
      // channel the registration table remembers is not where they are.
      everyone.push({ user: entry, channel: null, offline: true });
    }
  }

  const { roleOf, order, colors } = primaryRoles(input.roles);
  const buckets = new Map<string, RosterMember[]>();
  for (const member of everyone) {
    const id = member.user.user_id;
    // A user id of zero or below is Mumble's way of saying "not registered",
    // and an unregistered user is in no group by definition.
    const key = id == null || id <= 0 ? ROSTER_GUESTS : (roleOf.get(id) ?? ROSTER_MEMBERS);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(member);
    else buckets.set(key, [member]);
  }

  const groups: RosterGroup[] = [
    { key: "channel", kind: "channel", label: "", color: null, members: here.sort(compareMembers) },
  ];
  for (const name of order) {
    const members = buckets.get(name);
    if (!members) continue;
    groups.push({
      key: name,
      kind: "role",
      label: name,
      color: colors.get(name) ?? null,
      members: members.sort(compareMembers),
    });
  }
  for (const [key, kind] of [
    [ROSTER_MEMBERS, "members"],
    [ROSTER_GUESTS, "guests"],
  ] as const) {
    const members = buckets.get(key);
    if (!members) continue;
    groups.push({ key, kind, label: "", color: null, members: members.sort(compareMembers) });
  }
  return groups.filter((group) => group.members.length > 0);
}

export interface ChannelPresence {
  /** People sitting in the channel right now. */
  inVoice: number;
  /** Everyone the channel counts as its own: the people in it, plus the people
   *  who belong to it and are somewhere else. */
  members: number;
}

/**
 * How many people are in a channel, and how many belong to it.
 *
 * A plain channel has no membership beyond who is standing in it, so both
 * numbers are the same. A persisted one does: the server names the people
 * holding the key its history is stored under, and someone who has stepped out
 * still belongs to the room their messages are kept in.
 *
 * Absent members are counted by key rather than by "offline", so the number
 * does not drop when one of them connects and sits in a different channel -
 * a membership that shrank whenever a member appeared would be worse than no
 * membership at all.
 */
export function channelPresence(
  users: readonly UserEntry[],
  channelId: number,
  keyHolders: readonly KeyHolderEntry[] = [],
): ChannelPresence {
  const present = users.filter((user) => user.channel_id === channelId);
  const hereByHash = new Set(present.map((user) => user.hash).filter(Boolean));
  const away = keyHolders.filter((holder) => !hereByHash.has(holder.cert_hash)).length;
  return { inVoice: present.length, members: present.length + away };
}

/**
 * The header's subtitle - "3 in voice · 5 members".
 *
 * The second half is dropped when it would only restate the first: on the
 * ordinary channel, where everyone who belongs is present, "5 in voice ·
 * 5 members" says one thing twice.
 */
export function presenceLabel(t: SelectorT, presence: ChannelPresence): string {
  if (presence.members === 0) return t("presence.nobodyHere");
  const voice = t("presence.inVoice", { count: presence.inVoice });
  if (presence.members <= presence.inVoice) return voice;
  return t("presence.withMembers", { voice, count: presence.members });
}

/**
 * Whether a channel's messages are end-to-end encrypted.
 *
 * Read off the announced protocol rather than off the persistence state:
 * they agree today, but they are two different claims - one about where the
 * history is kept, one about who can read it - and the header makes both.
 */
export function isEncryptedChannel(channel: ChannelEntry | null | undefined): boolean {
  return channel?.pchat_protocol === "signal_v1" || channel?.pchat_protocol === "fancy_v1_full_archive";
}

export interface UserMenuInput {
  user: UserEntry;
  channels: readonly ChannelEntry[];
  ownSession: number | null;
  /** The channel the user is joined to, so "join them" can be hidden when already there. */
  currentChannel: number | null;
}

/** What the user menu may offer for one person, given what the server has granted. */
export interface UserMenuActions {
  isSelf: boolean;
  /** The channel the target is sitting in, for the "join them" label. */
  userChannel: ChannelEntry | null;
  canJoinChannel: boolean;
  canMuteDeafen: boolean;
  canMove: boolean;
  canKick: boolean;
  canBan: boolean;
  canRegister: boolean;
  canUnregister: boolean;
  canResetContent: boolean;
  /** True when any of the moderation actions above is available. */
  hasModeration: boolean;
}

/**
 * Which user actions the server has actually granted.
 *
 * Each permission is read on the channel that governs it rather than on
 * whichever channel is convenient: mute, deafen and move are decided by the
 * channel the *target* is sitting in, and kick, ban, registration and content
 * resets at the root. Checking "any channel" would offer Move to someone who
 * owns a temporary channel but holds nothing over the room the target is in,
 * and the action would fail at the server after the menu had promised it.
 *
 * Nothing is ever offered against yourself - every one of these has a first-
 * person control elsewhere, and a self-kick is not a feature.
 */
export function userMenuActions({
  user,
  channels,
  ownSession,
  currentChannel,
}: UserMenuInput): UserMenuActions {
  const isSelf = user.session === ownSession;
  const userChannel = channels.find((channel) => channel.id === user.channel_id) ?? null;
  const userChannelPermissions = userChannel?.permissions ?? 0;
  const rootPermissions = channels.find((channel) => channel.id === 0)?.permissions ?? 0;

  const granted = (permissions: number, bit: number) => !isSelf && (permissions & bit) !== 0;

  const canRegisterAnyone = granted(rootPermissions, PERM_REGISTER);
  // SuperUser is user_id 0 and counts as unregistered here, which is what
  // keeps "Deregister" - the action that deletes an account's server-side
  // data - off the one account that must not be deleted.
  const unregistered = user.user_id == null || user.user_id === 0;

  const actions = {
    isSelf,
    userChannel,
    canJoinChannel: !isSelf && user.channel_id !== currentChannel,
    canMuteDeafen: granted(userChannelPermissions, PERM_MUTE_DEAFEN),
    canMove: granted(userChannelPermissions, PERM_MOVE),
    canKick: granted(rootPermissions, PERM_KICK),
    canBan: granted(rootPermissions, PERM_BAN),
    canRegister: canRegisterAnyone && unregistered,
    canUnregister: canRegisterAnyone && !unregistered,
    canResetContent: granted(rootPermissions, PERM_RESET_USER_CONTENT),
  };

  return {
    ...actions,
    hasModeration:
      actions.canMuteDeafen ||
      actions.canMove ||
      actions.canKick ||
      actions.canBan ||
      actions.canRegister ||
      actions.canUnregister ||
      actions.canResetContent,
  };
}

export interface DaySection<T> {
  /** Local day key, `YYYY-MM-DD`. */
  key: string;
  /** "Today", "Yesterday", or a formatted date. */
  label: string;
  messages: T[];
}

function dayKey(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Split a message list into the mock's day-labelled sections.
 *
 * Messages without a timestamp come from legacy servers; they keep their place
 * in the list by joining whichever section is currently open, so ordering never
 * changes just because a sender's client is old.
 */
export function groupMessagesByDay<T extends { timestamp?: number | null }>(
  t: SelectorT,
  messages: readonly T[],
  now: Date = new Date(),
): DaySection<T>[] {
  const today = dayKey(now);
  const yesterdayDate = new Date(now);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = dayKey(yesterdayDate);

  const sections: DaySection<T>[] = [];
  for (const message of messages) {
    const stamp = message.timestamp;
    const key = stamp ? dayKey(new Date(stamp)) : (sections.at(-1)?.key ?? today);
    const open = sections.at(-1);
    if (open?.key === key) {
      open.messages.push(message);
      continue;
    }
    const label =
      key === today
        ? t("day.today")
        : key === yesterday
          ? t("day.yesterday")
          : new Date(stamp ?? now.getTime()).toLocaleDateString(undefined, {
              weekday: "short",
              day: "numeric",
              month: "short",
            });
    sections.push({ key, label, messages: [message] });
  }
  return sections;
}

/** Message bodies are HTML; sidebar previews want one line of text. */
export function plainText(body: string): string {
  if (typeof DOMParser === "undefined") return body;
  const text = new DOMParser().parseFromString(body, "text/html").body.textContent ?? "";
  return text.replace(/\s+/g, " ").trim();
}

/**
 * What a message body actually is.
 *
 * A chat body is HTML, but some bodies are a marker standing in for a richer
 * object the server broadcast separately - a poll, or a file on the file
 * server. Rendering those as HTML prints the marker comment's neighbours and
 * silently drops the object, which is what Nebula did before: a poll arrived
 * as its bare question text and an attachment as nothing at all. Classifying
 * here keeps the decision out of the row and testable on its own.
 *
 * `html` is always what is left once the marker is lifted out, so a caption
 * sent alongside a file still renders above its card.
 *
 * It is also always renderable markup. A body that arrived as plain markdown -
 * a bot, a bridge, a legacy client - is formatted here rather than at each of
 * the four places that draw one, which is how Nebula came to print `**Nice**`
 * with its asterisks showing. See `bodyToHtml`; markers come off first, so the
 * caption beside a file is formatted too.
 */
export type MessageContent = {
  /** Ids of the messages this one is replying to, oldest marker first. */
  quoteIds: string[];
  html: string;
} & (
  | { kind: "text" }
  | { kind: "poll"; pollId: string }
  /** Every file marker in the body, in the order they were written. */
  | { kind: "file"; payloads: string[] }
);

/** One picture lifted out of a message body. */
export interface BodyImage {
  readonly src: string;
  readonly alt: string;
}

/**
 * Take the pictures out of a message body and hand them back separately.
 *
 * Rendered inside the body, a photograph inherits the bubble: a rounded panel,
 * fourteen pixels of padding and a border, all of it drawn around a picture
 * that is already a rectangle with an edge. That is the frame around every
 * received image - and it is why several pictures sent together came out as a
 * column of framed rectangles rather than one block.
 *
 * So they come out, and the row draws them itself: text keeps the bubble,
 * pictures get the gallery, and a message that is only pictures gets no
 * bubble at all.
 *
 * The `src` is handed over exactly as written - the lightbox's gallery is
 * indexed by that string, not by the URL a browser would resolve it to.
 */
export function splitBodyImages(html: string): { html: string; images: BodyImage[] } {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const found = doc.querySelectorAll("img");
  // Nothing was touched, so hand back the string that came in rather than a
  // re-serialised copy of it.
  if (found.length === 0) return { html, images: [] };

  const images: BodyImage[] = [];
  for (const image of found) {
    const src = image.getAttribute("src") ?? "";
    // A picture with no source is nothing to show and nothing to enlarge, but
    // it is still markup: drop it rather than leaving a broken tile behind.
    if (src) images.push({ src, alt: image.getAttribute("alt") ?? "" });
    image.remove();
  }
  return { html: doc.body.innerHTML.trim(), images };
}

const POLL_MARKER = /<!-- FANCY_POLL:(.+?) -->/;
const FILE_MARKER = /<!-- FANCY_FILE:([A-Za-z0-9+/=]+) -->/g;
const QUOTE_MARKER = /<!-- FANCY_QUOTE:(.+?) -->/g;

export function messageContent(body: string): MessageContent {
  // Quotes come off first and are orthogonal to the rest: a reply can carry a
  // poll or a file as easily as it can carry text, and leaving the markers in
  // would make every quoted message look like a plain one with comment
  // rubbish in it.
  const quoteIds = [...body.matchAll(QUOTE_MARKER)].map((match) => match[1]);
  const rest = quoteIds.length > 0 ? body.replaceAll(QUOTE_MARKER, "").trim() : body;

  const poll = POLL_MARKER.exec(rest);
  if (poll) {
    const html = bodyToHtml(rest.replace(POLL_MARKER, "").trim());
    return { kind: "poll", pollId: poll[1], quoteIds, html };
  }

  // Every marker, not the first: a batch of photographs sent together is one
  // message carrying one marker each, and reading only the first would draw
  // the first picture and silently drop the rest.
  const files = [...rest.matchAll(FILE_MARKER)].map((match) => match[1]!);
  if (files.length > 0) {
    const html = bodyToHtml(rest.replaceAll(FILE_MARKER, "").trim());
    return { kind: "file", payloads: files, quoteIds, html };
  }

  return { kind: "text", quoteIds, html: bodyToHtml(rest) };
}

/**
 * What the composer puts on the wire for a line of typed text.
 *
 * The editable surface decorates markdown as it is typed, so the wire format
 * has to be the markdown one. Escaping the draft instead is what made the
 * formatting stop at the composer's edge: what was drawn bold while it was
 * being written arrived at everyone else as a word between four asterisks.
 *
 * Standard's converter is called rather than a second one written here. The
 * two packs send into the same channels, and a dialect that differed between
 * them would read as one client's messages formatting and the other's not.
 */
export function composerHtml(text: string): string {
  return markdownToHtml(text);
}

/**
 * A message body turned back into what its author typed.
 *
 * The inverse of `composerHtml`, so a message opened for editing shows the
 * markdown that produced it rather than the markup it was stored as. The two
 * are one round trip and live together for that reason: an edit that
 * re-encoded text differently from the way it was first sent would rewrite
 * the message on every save.
 */
export function editableText(body: string): string {
  return htmlToMarkdown(body);
}

/** `18:06` in the user's locale, matching the mock's message stamps. */
/**
 * The clock settings a timestamp is read under.
 *
 * Three separate preferences decide what "14:05" should say, and a reading
 * that consults none of them is not a shorter answer but a different one: the
 * user picked 12-hour and got 24, or asked for the server's time and got their
 * own. They travel together because they are only ever used together.
 */
export interface TimeDisplay {
  /** "12h", "24h", or "auto" - follow the operating system. */
  timeFormat: TimeFormat;
  /** False reads the stamp in UTC, which is what "show server time" asks for. */
  localTime: boolean;
  /** What the OS reports for "auto"; undefined falls back to `Intl`. */
  systemUses24h: boolean | undefined;
}

/** What the clock reads as before the stored preferences have arrived. */
export const DEFAULT_TIME_DISPLAY: TimeDisplay = {
  timeFormat: "auto",
  localTime: true,
  systemUses24h: undefined,
};

/**
 * A message's time of day, under the reader's own settings.
 *
 * The formatting itself is core's, shared with Standard: a clock that differs
 * between two designs of the same client is a bug in whichever one you are not
 * looking at. Nebula's Language & format page writes exactly these fields.
 */
export function formatTime(
  timestamp: number | null | undefined,
  display: TimeDisplay = DEFAULT_TIME_DISPLAY,
): string {
  if (!timestamp) return "";
  return formatTimestamp(timestamp, display.timeFormat, display.localTime, display.systemUses24h);
}

export interface ServerGroup {
  /** `host:port`, lowercased - the identity of the server itself. */
  key: string;
  label: string;
  host: string;
  port: number;
  /** Every saved identity for this address, favourites first. */
  identities: SavedServer[];
  /** True when any identity on this address is pinned. */
  favorite: boolean;
  /** Live session id when one of the identities is connected. */
  sessionId: string | null;
}

export interface GroupableSession {
  id: string;
  host: string;
  port: number;
  username: string;
  /**
   * Live sessions are the ones holding a tab. A disconnected session is a
   * leftover slot that Nebula draws nothing for, so it must not count as open.
   * Optional, and assumed live when absent, for callers that only have an
   * address to match on.
   */
  status?: ConnectionStatus;
}

/** Whether a session is actually holding the tab, rather than being a husk. */
function isLive(session: GroupableSession): boolean {
  return session.status !== "disconnected";
}

/**
 * One row per server, not per saved login.
 *
 * Identities are stored as separate saved entries that happen to share an
 * address, so listing the raw records shows the same server once per account.
 * The server is the thing being chosen in the sidebar; which identity to arrive
 * as is the connect screen's question.
 */
export function groupSavedServers(
  savedServers: readonly SavedServer[] | null,
  sessions: readonly GroupableSession[] = [],
): ServerGroup[] {
  const groups = new Map<string, ServerGroup>();

  for (const server of savedServers ?? []) {
    const key = `${server.host}:${server.port}`.toLocaleLowerCase();
    const group = groups.get(key) ?? {
      key,
      label: server.label || server.host,
      host: server.host,
      port: server.port,
      identities: [],
      favorite: false,
      sessionId: null,
    };
    group.identities.push(server);
    // A favourited identity names the server: it is the label the user chose
    // for the address, not just for that account.
    if (server.favorite) {
      group.favorite = true;
      group.label = server.label || server.host;
    }
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    group.identities.sort(
      (left, right) =>
        Number(!!right.favorite) - Number(!!left.favorite) || left.username.localeCompare(right.username),
    );
    const live = sessions.find(
      (session) => `${session.host}:${session.port}`.toLocaleLowerCase() === group.key && isLive(session),
    );
    group.sessionId = live?.id ?? null;
  }

  return [...groups.values()].sort(
    (left, right) => Number(right.favorite) - Number(left.favorite) || left.label.localeCompare(right.label),
  );
}

/** What a rail tile is doing. */
export type ServerRailStatus = "connected" | "connecting" | "saved";

/**
 * One tile on the server rail.
 *
 * The rail lists *servers*, so a tile is keyed on the address rather than on a
 * session: a saved server nobody is connected to still has one, and two
 * identities on one address share one. The session, where there is one, is
 * what the tile reports on.
 */
export interface ServerRailEntry {
  group: ServerGroup;
  session: (GroupableSession & { label?: string }) | null;
  status: ServerRailStatus;
  /** Messages waiting here. Zero unless the server is connected. */
  unread: number;
}

/** `host:port`, lowercased - the identity of the server itself. */
function addressKey(address: { host: string; port: number }): string {
  return `${address.host}:${address.port}`.toLocaleLowerCase();
}

/**
 * The rail, in the order it is drawn.
 *
 * Saved servers come first, in whatever order the user dragged them into. A
 * server connected without ever having been saved - an address typed straight
 * into quick connect - appends rather than going missing, because the rail is
 * the only way back to its tab.
 *
 * Unread is read off the session rather than the saved entry: it belongs to
 * the connection, so a server nobody is on has nothing waiting by definition.
 * Tiles the stored order says nothing about append instead of jumping to the
 * front, so connecting somewhere new never reshuffles the rail.
 */
export function serverRailEntries(
  groups: readonly ServerGroup[],
  sessions: readonly (GroupableSession & { label?: string })[] = [],
  unreadTotals: Readonly<Record<string, number>> = {},
  order: readonly string[] = [],
): ServerRailEntry[] {
  const entryFor = (group: ServerGroup): ServerRailEntry => {
    const session = sessions.find((candidate) => addressKey(candidate) === group.key && isLive(candidate));
    return {
      group,
      session: session ?? null,
      status: !session ? "saved" : session.status === "connecting" ? "connecting" : "connected",
      unread: session ? (unreadTotals[session.id] ?? 0) : 0,
    };
  };

  const byKey = new Map<string, ServerRailEntry>();
  for (const group of groups) byKey.set(group.key, entryFor(group));

  for (const session of sessions) {
    const key = addressKey(session);
    if (!isLive(session) || byKey.has(key)) continue;
    byKey.set(
      key,
      entryFor({
        key,
        label: session.label || session.host,
        host: session.host,
        port: session.port,
        identities: [],
        favorite: false,
        sessionId: session.id,
      }),
    );
  }

  const rank = new Map(order.map((key, index) => [key, index]));
  const rankOf = (entry: ServerRailEntry) => rank.get(entry.group.key) ?? Number.MAX_SAFE_INTEGER;
  return [...byKey.values()].sort((left, right) => rankOf(left) - rankOf(right));
}

/**
 * The rail order to persist after a tile is dropped.
 *
 * A move is expressed as "this key now sits where that one was" rather than as
 * a pair of indices: the list the user dragged in is the rendered one, and an
 * index into it stops meaning anything the moment a server connects or a saved
 * entry is removed. A null target drops the tile at the end.
 */
export function reorderServerRail(
  entries: readonly ServerRailEntry[],
  movedKey: string,
  beforeKey: string | null,
): string[] {
  const keys = entries.map((entry) => entry.group.key);
  // Dropping a tile on itself is a no-op, not a move to the end.
  if (movedKey === beforeKey || !keys.includes(movedKey)) return keys;

  const rest = keys.filter((key) => key !== movedKey);
  const at = beforeKey === null ? -1 : rest.indexOf(beforeKey);
  rest.splice(at === -1 ? rest.length : at, 0, movedKey);
  return rest;
}

export { userTint, type UserTint } from "@shared/profilecard/tint";

/** The two stops of the gradient an unbranded server is drawn with. */
export interface ServerTint {
  from: string;
  to: string;
}

/**
 * The colour pair assigned to a server that supplies no branding of its own.
 *
 * The mock never draws an unbranded server flat: the sidebar tile, the connect
 * banner and the big icon all pull from one muted two-stop diagonal, so an
 * address is recognisable before its name is read. Saturation, lightness and
 * the spread between the stops are the mock's own; only the hue comes from the
 * address, which keeps every generated pair as quiet as the one it was drawn
 * from instead of letting some servers arrive brighter than others.
 */
export function serverTint(key: string): ServerTint {
  const hue = hueFromKey(key);
  return {
    from: hslToHex({ h: hue, s: 23, l: 46 }),
    to: hslToHex({ h: (hue + 274) % 360, s: 23, l: 46 }),
  };
}

/** One row of quick connect: a server, and the login it will arrive as. */
export interface QuickConnectTarget {
  /** The server the row is about - its name, its colour, its ping. */
  group: ServerGroup;
  /** The saved login this row opens a tab as. Never one that already has one. */
  identity: SavedServer;
}

/** `host:port|username`, the triple the backend decides tab reuse on. */
function identityKey(target: { host: string; port: number; username: string }): string {
  return `${`${target.host}:${target.port}`.toLocaleLowerCase()}|${target.username}`;
}

/**
 * The servers quick connect offers, in the order it offers them.
 *
 * What is already open is a *login*, not an address: the backend keys a tab on
 * host, port and username, so a second identity on a server you are already in
 * opens a second tab. Filtering by address would hide exactly that - the case
 * quick connect is most useful for - so each server is offered as long as it
 * has a login that is not already open, and drops out only once none is left.
 *
 * Only a live session counts as open. A disconnected one is a slot the backend
 * kept for reuse, which Nebula draws no tab for, so hiding its login would
 * leave no way back into a server the user has just left.
 *
 * Ranked by recency first, since quick connect exists to get back to where you
 * were and the alphabet knows nothing about that. Logins never used fall to the
 * bottom, favourites first among them.
 */
export function quickConnectTargets(
  groups: readonly ServerGroup[],
  sessions: readonly GroupableSession[] = [],
): QuickConnectTarget[] {
  const open = new Set(sessions.filter(isLive).map(identityKey));

  return groups
    .flatMap((group) => {
      const identity = preferredIdentity(
        group.identities.filter((candidate) => !open.has(identityKey(candidate))),
      );
      return identity ? [{ group, identity }] : [];
    })
    .sort(
      (left, right) =>
        (right.identity.last_joined ?? 0) - (left.identity.last_joined ?? 0) ||
        Number(!!right.identity.favorite) - Number(!!left.identity.favorite) ||
        left.group.label.localeCompare(right.group.label),
    );
}

/**
 * The identity quick connect arrives as, out of those still available.
 *
 * Picking one is the whole point of the connect screen, so quick connect must
 * not ask: it repeats the last login used on that address, falling back to a
 * favourite and then to whichever sorted first. The row says which one it chose
 * whenever there is more than one to choose from.
 */
export function preferredIdentity(identities: readonly SavedServer[]): SavedServer | null {
  return (
    [...identities].sort(
      (left, right) =>
        (right.last_joined ?? 0) - (left.last_joined ?? 0) ||
        Number(!!right.favorite) - Number(!!left.favorite),
    )[0] ?? null
  );
}

/** Local midnight of the day a timestamp falls in. */
function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * How long ago a server was last joined, in the shortest form that is still
 * unambiguous: a weekday inside the last week, a date beyond it.
 *
 * Deliberately not "3 days ago" - a list of servers is scanned, not read, and a
 * weekday is recognised faster than an interval is decoded.
 */
export function formatLastJoined(timestamp: number | null, now: number = Date.now()): string | null {
  if (!timestamp) return null;
  const days = Math.round((startOfDay(now) - startOfDay(timestamp)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return new Date(timestamp).toLocaleDateString(undefined, { weekday: "short" });
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** One destination the quick switcher can send the window to. */
export interface QuickSwitchTarget {
  /** Stable list key, and what the caller matches a chosen row on. */
  key: string;
  kind: "channel" | "person" | "server";
  /** Channel id, user session, or session id - whichever `kind` says. */
  id: number | string;
  label: string;
  detail: string;
}

/** Everything the quick switcher can reach, before the query narrows it. */
export interface QuickSwitchInput {
  /** Rides in the input so the whole matching chain can name what it found. */
  t: SelectorT;
  channels: readonly ChannelEntry[];
  users: readonly UserEntry[];
  sessions: readonly (GroupableSession & { label?: string })[];
  ownSession: number | null;
  query: string;
  /** Rows to keep. The list is scanned, not paged. */
  limit?: number;
}

/**
 * Everything in the store the query could mean: channels, people, open servers.
 *
 * This is the matching half only - what comes back is unranked and ungrouped,
 * and `globalSearchRows` is what scores it, heads it and caps it. The query is
 * tried against the name and the detail line both, so a server can be found by
 * its address and a channel by the count beside it.
 *
 * Only live sessions are offered - switching to a disconnected slot lands on
 * nothing - and the user's own row is left out, there being no conversation to
 * open with yourself.
 */
export function quickSwitchTargets(input: QuickSwitchInput): QuickSwitchTarget[] {
  const { t } = input;
  const targets: QuickSwitchTarget[] = [
    ...input.channels
      .filter((channel) => !channel.detached)
      .map((channel) => ({
        key: `channel-${channel.id}`,
        kind: "channel" as const,
        id: channel.id,
        label: channel.name,
        detail: t("jump.peopleHere", { count: channel.user_count }),
      })),
    ...input.users
      .filter((user) => user.session !== input.ownSession)
      .map((user) => ({
        key: `person-${user.session}`,
        kind: "person" as const,
        id: user.session,
        label: user.name,
        detail: t("app.directMessage"),
      })),
    ...input.sessions.filter(isLive).map((session) => ({
      key: `server-${session.id}`,
      kind: "server" as const,
      id: session.id,
      label: session.label || session.host,
      detail: `${session.host}:${session.port}`,
    })),
  ];

  const needle = input.query.trim().toLocaleLowerCase();
  const matches = needle
    ? targets.filter((target) => `${target.label} ${target.detail}`.toLocaleLowerCase().includes(needle))
    : targets;
  return matches.slice(0, input.limit ?? 30);
}

/** What a global-search row stands for. */
export type GlobalSearchKind = "channel" | "person" | "message" | "server";

/** The subject of a row's picture, for the rows that have one. */
export interface GlobalSearchAvatar {
  name: string;
  session: number | null;
  textureSize: number | null;
}

/** One row of the global search, already carrying everything it draws. */
export interface GlobalSearchRow {
  /** Stable list key, and what the caller matches a chosen row on. */
  key: string;
  kind: GlobalSearchKind;
  /** Channel id, user session, or session id - whichever `kind` says. */
  id: number | string;
  /**
   * The row's own name: a channel, a person, a server, or - on a message - who
   * sent it. The query is picked out of this on every kind but `message`,
   * where the excerpt is what actually matched.
   */
  title: string;
  /** Dim continuation of the title: `in #Gaming`, `DM with enot`. */
  context: string | null;
  /** Second line: the server a channel is on, where a person is sitting, the
   *  excerpt a message matched on. */
  subtitle: string;
  /** Right-hand column: an occupancy count, a time of day. */
  meta: string;
  /** Whether `meta` is worth the positive tone - a channel with someone in it.
   *  An empty channel and a timestamp are counts, not good news. */
  occupied: boolean;
  /**
   * How well this matched, on the backend's scale: lower is better, and an
   * exact substring scores the text that surrounds it. Ranks the row inside
   * its group and, through its group's best row, the groups against each other.
   */
  score: number;
  /**
   * What selecting the row lands on, which is not always what it shows: a
   * message opens the channel, or the conversation, it was said in.
   */
  opens: "channel" | "person" | "server";
  /** Picture subject; channels and servers draw a glyph tile instead. */
  avatar: GlobalSearchAvatar | null;
  /** Presence pip, for rows standing for someone currently connected. */
  online: boolean;
}

/** Everything the global search draws from, for one query. */
export interface GlobalSearchInput {
  /** Rides in the input so the whole matching chain can name what it found. */
  t: SelectorT;
  /** What `super_search` answered with. Empty while the query is blank - the
   *  backend has nothing to fuzzy-match against and returns nothing. */
  results: readonly SearchResult[];
  channels: readonly ChannelEntry[];
  users: readonly UserEntry[];
  sessions: readonly (GroupableSession & { label?: string })[];
  ownSession: number | null;
  /** How the server the results came from is named under a channel. */
  serverLabel: string;
  query: string;
  /** The clock a matched message's time is read under. */
  time?: TimeDisplay;
}

/** Kinds in the order the mock heads them, and the tie-break when two groups
 *  match equally well. */
const GLOBAL_SEARCH_ORDER: readonly GlobalSearchKind[] = ["channel", "person", "message", "server"];

/**
 * Rows kept per group.
 *
 * Every group has to fit on the panel at once, or the ones the mock heads last
 * are only reachable by scrolling past the first - which is how a server with a
 * few dozen channels ends up looking like it has no people in it at all. The
 * palette is for jumping to the obvious answer; the sidebar is where a long
 * list belongs.
 */
const MAX_PER_GROUP = 6;

/**
 * What the backend's scorer gives an exact substring hit: the text surrounding
 * the match, so a shorter host for the same query wins. `null` when the query
 * is not in the text at all.
 *
 * Only the substring half of `fuzzy_score` is mirrored here, because that is
 * the only half this side matches on. Scores from both sources therefore sit on
 * one scale, which is what lets a locally-matched channel and a backend-matched
 * message be compared at all.
 */
function substringScore(query: string, text: string): number | null {
  if (!query) return 0;
  const needle = query.toLocaleLowerCase();
  const haystack = text.toLocaleLowerCase();
  if (!haystack.includes(needle)) return null;
  return haystack.length - needle.length;
}

function occupancy(t: SelectorT, count: number): string {
  return t("jump.peopleHere", { count });
}

function channelRow(
  t: SelectorT,
  id: number,
  fallbackName: string,
  channel: ChannelEntry | undefined,
  serverLabel: string,
  score: number,
): GlobalSearchRow {
  const count = channel?.user_count ?? 0;
  return {
    key: `channel-${id}`,
    kind: "channel",
    id,
    title: channel?.name ?? fallbackName,
    context: null,
    subtitle: serverLabel,
    meta: occupancy(t, count),
    occupied: count > 0,
    score,
    opens: "channel",
    avatar: null,
    online: false,
  };
}

function personRow(
  t: SelectorT,
  session: number,
  fallbackName: string,
  user: UserEntry | undefined,
  channels: readonly ChannelEntry[],
  score: number,
): GlobalSearchRow {
  const seat = user && channels.find((channel) => channel.id === user.channel_id);
  const name = user?.name ?? fallbackName;
  return {
    key: `person-${session}`,
    kind: "person",
    id: session,
    title: name,
    context: null,
    // Everyone on a Mumble server occupies a channel, so a person the roster
    // still knows is by definition reachable in voice; one who has left is
    // only somebody to write to.
    subtitle: seat ? t("jump.inVoiceChannel", { channel: seat.name }) : t("app.directMessage"),
    meta: "",
    occupied: false,
    score,
    opens: "person",
    avatar: { name, session, textureSize: user?.texture_size ?? null },
    online: user != null,
  };
}

function serverRow(target: QuickSwitchTarget, score: number): GlobalSearchRow {
  return {
    key: target.key,
    kind: "server",
    id: target.id,
    title: target.label,
    context: null,
    subtitle: target.detail,
    meta: "",
    occupied: false,
    score,
    opens: "server",
    avatar: null,
    online: false,
  };
}

/**
 * The backend's results as rows, with what only this window knows filled in.
 *
 * `super_search` fuzzy-matches over the session it holds, which is where the
 * ranking has to happen - the store keeps no message history to rank. What it
 * cannot say is how the row should read here: how many people are sitting in a
 * channel, which server they are on, what a sender's avatar is. Those come off
 * the store the sidebar is already drawn from, so a row can never disagree with
 * the tree behind it.
 */
function matchedRows(input: GlobalSearchInput): GlobalSearchRow[] {
  const rows: GlobalSearchRow[] = [];
  for (const result of input.results) {
    if (result.id === null) continue;
    if (result.category === "channel") {
      const channel = input.channels.find((entry) => entry.id === result.id);
      if (channel?.detached) continue;
      rows.push(channelRow(input.t, result.id, result.title, channel, input.serverLabel, result.score));
    } else if (result.category === "user") {
      if (result.id === input.ownSession) continue;
      const user = input.users.find((entry) => entry.session === result.id);
      rows.push(personRow(input.t, result.id, result.title, user, input.channels, result.score));
    } else {
      const message = result.message;
      if (!message) continue;
      const sender = input.users.find((entry) => entry.session === message.sender_session);
      rows.push({
        // A message is addressed by its own id where it has one; two messages
        // in the same channel would otherwise collide on the channel's.
        key: `message-${result.string_id ?? `${result.id}-${message.timestamp ?? rows.length}`}`,
        kind: "message",
        id: result.id,
        title: message.sender_name,
        context: message.context,
        subtitle: plainText(result.title),
        meta: formatTime(message.timestamp, input.time),
        occupied: false,
        score: result.score,
        opens: message.dm ? "person" : "channel",
        avatar: {
          name: message.sender_name,
          session: message.sender_session ?? null,
          textureSize: sender?.texture_size ?? null,
        },
        online: false,
      });
    }
  }
  return rows;
}

/**
 * What this window can match on its own.
 *
 * The channels and people already in the store are matched here rather than
 * waited for: the backend answer is a debounce and an IPC round trip away, and
 * a panel that stays empty for the first few keystrokes reads as one that found
 * nothing. Open servers are matched here for a different reason - the backend
 * searches one session and knows nothing of the others this window is holding.
 * With a blank query this is the whole list, which is what the panel rests on
 * before anything has been typed.
 */
function localRows(input: GlobalSearchInput): GlobalSearchRow[] {
  const needle = input.query.trim();
  // The name is what the reader thinks they are typing, so it is scored first;
  // the detail line only carries the match for a server found by its address.
  const score = (target: QuickSwitchTarget) =>
    substringScore(needle, target.label) ?? substringScore(needle, `${target.label} ${target.detail}`) ?? 0;

  // Unlimited deliberately: `quickSwitchTargets` truncates the combined list,
  // so its own cap would spend every slot on channels and leave a busy server
  // looking as though nobody is on it. Capping is this module's job, and it
  // does it per group, below.
  return quickSwitchTargets({ ...input, limit: Number.POSITIVE_INFINITY }).map((target) => {
    if (target.kind === "channel") {
      const id = Number(target.id);
      return channelRow(
        input.t,
        id,
        target.label,
        input.channels.find((channel) => channel.id === id),
        input.serverLabel,
        score(target),
      );
    }
    if (target.kind === "person") {
      const session = Number(target.id);
      return personRow(
        input.t,
        session,
        target.label,
        input.users.find((user) => user.session === session),
        input.channels,
        score(target),
      );
    }
    return serverRow(target, score(target));
  });
}

/**
 * Channels, people, messages and open servers as one list.
 *
 * Both sources are kept. What the window can match itself appears at once,
 * since the backend is a debounce and a round trip behind the keystroke; the
 * backend then adds what only it can reach - the message history, and the
 * looser matches its fuzzy scorer allows. A search that fails outright
 * therefore degrades to the local list rather than to nothing.
 *
 * Rows are still gathered into the groups the mock heads, because a list that
 * interleaves a channel, a person and a message is read one row at a time
 * rather than scanned. But which group comes first follows the match, not a
 * fixed running order: a message that says exactly what was typed is what was
 * being looked for, and burying it under a channel that merely contains those
 * letters in order is the palette answering a question nobody asked. Groups are
 * therefore ordered by their best row, and each is capped so the later ones are
 * on the panel at all.
 */
export function globalSearchRows(input: GlobalSearchInput): GlobalSearchRow[] {
  // With nothing typed there is no better or worse, only the canonical order.
  const ranked = input.query.trim().length > 0;

  const best = new Map<string, GlobalSearchRow>();
  for (const row of [...localRows(input), ...matchedRows(input)]) {
    const seen = best.get(row.key);
    if (!seen) best.set(row.key, row);
    // The same row found twice keeps the better of the two scores; the local
    // reading of it is already the richer one, so only the score is taken.
    else if (row.score < seen.score) best.set(row.key, { ...seen, score: row.score });
  }

  const groups = new Map<GlobalSearchKind, GlobalSearchRow[]>();
  for (const row of best.values()) {
    const bucket = groups.get(row.kind);
    if (bucket) bucket.push(row);
    else groups.set(row.kind, [row]);
  }

  const headed = [...groups.entries()].map(([kind, rows]) => {
    const sorted = ranked ? [...rows].sort((left, right) => left.score - right.score) : rows;
    return { kind, rows: sorted.slice(0, MAX_PER_GROUP) };
  });

  headed.sort(
    (left, right) =>
      (ranked ? (left.rows[0]?.score ?? 0) - (right.rows[0]?.score ?? 0) : 0) ||
      GLOBAL_SEARCH_ORDER.indexOf(left.kind) - GLOBAL_SEARCH_ORDER.indexOf(right.kind),
  );

  return headed.flatMap((group) => group.rows);
}
