/**
 * Mentions support adapted for Mumble.
 *
 * Wire format inside the raw markdown / message body:
 *   <@SESSION>        user mention (numeric live session id)
 *   <@&GROUP_NAME>    ACL group / role mention
 *   @everyone         channel-wide mention
 *   @here             "online here" mention
 *
 * On send, `applyMentionsToHtml` rewrites these markers into rendered
 * chip spans with `data-mention-*` attributes so receivers (which just
 * see the HTML body) can both display chips and detect self-mentions
 * for notifications without needing to re-parse the raw markup.
 */

import type { AclGroup, UserEntry } from "../types";
import { bodyToPlainText, INLINE_TAGS } from "../features/chat/bodyText";

// -- Wire format helpers -----------------------------------------------

const USER_MENTION_RE = /<@(\d+)>/g;
const ROLE_MENTION_RE = /<@&([^>\s]+)>/g;

/** Format a user mention marker for insertion into the draft. */
export function formatUserMention(session: number): string {
  return `<@${session}>`;
}

/** Format a role/group mention marker for insertion into the draft. */
export function formatRoleMention(name: string): string {
  return `<@&${name}>`;
}

// -- Trigger detection (autocomplete) ----------------------------------

export interface MentionTrigger {
  /** Index of the `@` character in the draft. */
  readonly anchor: number;
  /** Search query typed after the `@` (excluding the `@` itself). */
  readonly query: string;
  /** Mention kind based on the leading character after `@`. */
  readonly kind: "user" | "role";
}

/**
 * Detect an active mention trigger at the current cursor position.
 *
 * Returns null when no `@` is currently being typed. Triggers terminate
 * on whitespace or when the `@` is preceded by a non-whitespace,
 * non-newline character (so email addresses don't trigger).
 */
export function parseMentionTrigger(draft: string, cursor: number): MentionTrigger | null {
  if (cursor < 1) return null;

  // Walk backwards from cursor looking for an unbroken token.
  let i = cursor - 1;
  while (i >= 0) {
    const ch = draft.charAt(i);
    if (ch === "@") break;
    // Whitespace, control chars, or angle brackets break the token.
    if (/[\s<>]/.test(ch)) return null;
    i -= 1;
  }
  if (i < 0 || draft.charAt(i) !== "@") return null;

  // The `@` must be at start-of-text or preceded by whitespace.
  if (i > 0) {
    const prev = draft.charAt(i - 1);
    if (!/\s/.test(prev)) return null;
  }

  const after = draft.charAt(i + 1);
  const kind: "user" | "role" = after === "&" ? "role" : "user";
  const queryStart = kind === "role" ? i + 2 : i + 1;
  const query = draft.slice(queryStart, cursor);

  // Don't trigger for `@everyone` / `@here` exact matches (those are
  // their own thing and inserted as literal text without a chip
  // converter call).  Treat them as autocomplete suggestions instead.
  return { anchor: i, query, kind };
}

// -- Entity decoding ---------------------------------------------------

/** The five `escapeHtml` writes, plus the numeric forms a body may carry. */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
};

/**
 * Undo `escapeHtml` on a fragment of attribute or text content.
 *
 * Deliberately not a DOM round trip: this runs on the receive path for every
 * message body, and it must also work where there is no `DOMParser` at all.
 */
export function decodeEntities(s: string): string {
  return s.replace(/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match;
    }
    if (body.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

// -- HTML chip rendering -----------------------------------------------

export interface MentionResolver {
  /** Resolve a session ID to a display name for chip rendering. */
  resolveSession(session: number): { name: string } | null;
  /**
   * Resolve a role/group name to its FancyMumble customisation.
   * Optional - resolvers that only render user mentions can omit it.
   */
  resolveRole?(name: string): { color?: string | null } | null;
}

/** Sanitise a CSS color before embedding it in an inline style attribute. */
function sanitiseColor(color: string): string | null {
  const trimmed = color.trim();
  if (trimmed.length === 0 || trimmed.length > 64) return null;
  // Allow simple #rgb/#rgba hex, rgb()/rgba()/hsl()/hsla() and a-z color
  // names. Reject anything containing characters that could break out of
  // the inline style attribute.
  if (!/^[#A-Za-z0-9 .,()%/]+$/.test(trimmed)) return null;
  return trimmed;
}

/** What a chip is, once the markers have been read out of a text node. */
type Mention =
  | { readonly kind: "user"; readonly session: number }
  | { readonly kind: "role"; readonly name: string }
  | { readonly kind: "everyone" }
  | { readonly kind: "here" };

/**
 * The markers, as they read inside a *text node*.
 *
 * Not as they read in the HTML source: by the time the body is parsed, the
 * escaping `markdownToHtml` applied is undone, so `&lt;@1&gt;` is the three
 * characters `<@1>` here. That is what lets a role called `R&D` work - the
 * name is just its own characters, with no entity to trip over - and it makes
 * a raw marker from a bot read exactly like an escaped one from the composer.
 */
const MARKER_RE = /<@(\d+)>|<@&([^>]+)>|@(everyone|here)\b/g;

/** Elements whose text is shown rather than said, and so carries no mention.
 *  The same pair the receive side skips, so the two agree on what a mention
 *  is: a chip must appear exactly where a notification fires. */
const NOT_SPEECH_TAGS: ReadonlySet<string> = new Set(["code", "pre"]);

function chipFor(match: RegExpExecArray): Mention | null {
  if (match[1] !== undefined) return { kind: "user", session: Number(match[1]) };
  if (match[2] !== undefined) return { kind: "role", name: match[2] };
  if (match[3] === "everyone") return { kind: "everyone" };
  if (match[3] === "here") return { kind: "here" };
  return null;
}

/** Build the chip element for one mention, or null to leave the text alone. */
function chipElement(doc: Document, mention: Mention, resolver: MentionResolver): HTMLElement | null {
  const span = doc.createElement("span");
  if (mention.kind === "user") {
    const name = resolver.resolveSession(mention.session)?.name ?? `user-${mention.session}`;
    span.className = "mention mention-user";
    span.setAttribute("data-mention-session", String(mention.session));
    span.textContent = `@${name}`;
    return span;
  }
  if (mention.kind === "role") {
    const resolved = resolver.resolveRole?.(mention.name);
    const safeColor = resolved?.color ? sanitiseColor(resolved.color) : null;
    span.className = "mention mention-role";
    span.setAttribute("data-mention-role", mention.name);
    if (safeColor) {
      span.setAttribute(
        "style",
        `color:${safeColor};background:color-mix(in srgb, ${safeColor} 22%, transparent)`,
      );
    }
    span.textContent = `@${mention.name}`;
    return span;
  }
  span.className = `mention mention-${mention.kind}`;
  span.setAttribute(`data-mention-${mention.kind}`, "1");
  span.textContent = `@${mention.kind}`;
  return span;
}

/** Walk state: the last character of speech emitted so far, so `@everyone`
 *  can require a boundary before it without re-reading the document. */
interface Cursor {
  prev: string | null;
  changed: boolean;
}

/** True when a mention may start here: nothing before it, or a space, or the
 *  edge of a block. */
function atBoundary(prev: string | null): boolean {
  return prev === null || /\s/.test(prev);
}

/** Rewrite one text node's markers into chips, in place. */
function chipTextNode(node: Text, resolver: MentionResolver, cursor: Cursor): void {
  const text = node.nodeValue ?? "";
  if (text.length === 0) return;
  const doc = node.ownerDocument;
  const pieces: Node[] = [];
  let last = 0;
  let prev = cursor.prev;

  MARKER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MARKER_RE.exec(text)) !== null) {
    const lead = match.index === 0 ? prev : text.charAt(match.index - 1);
    // `@everyone` and `@here` are words, so they need a boundary in front or
    // `foo@everyone.example` becomes a channel-wide ping. The bracketed
    // markers are unambiguous and need none.
    const isWord = match[3] !== undefined;
    if (isWord && !atBoundary(lead)) continue;
    const mention = chipFor(match);
    if (!mention) continue;
    const chip = chipElement(doc, mention, resolver);
    if (!chip) continue;
    if (match.index > last) pieces.push(doc.createTextNode(text.slice(last, match.index)));
    pieces.push(chip);
    last = match.index + match[0].length;
    prev = null;
    cursor.changed = true;
  }

  if (pieces.length === 0) {
    cursor.prev = text.charAt(text.length - 1);
    return;
  }
  if (last < text.length) pieces.push(doc.createTextNode(text.slice(last)));
  cursor.prev = last < text.length ? text.charAt(text.length - 1) : "";
  node.replaceWith(...pieces);
}

/** Walk in reading order, chipping text and nothing else. */
function chipNode(node: Node, resolver: MentionResolver, cursor: Cursor): void {
  if (node.nodeType === Node.TEXT_NODE) {
    chipTextNode(node as Text, resolver, cursor);
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  // Already a chip: whatever is inside it has been decided.
  if (el.hasAttribute("data-mention-session") || el.hasAttribute("data-mention-role")) return;
  if (NOT_SPEECH_TAGS.has(tag)) {
    cursor.prev = " ";
    return;
  }
  if (tag === "br") {
    cursor.prev = " ";
    return;
  }
  const block = !INLINE_TAGS.has(tag);
  if (block) cursor.prev = " ";
  for (const child of Array.from(el.childNodes)) chipNode(child, resolver, cursor);
  if (block) cursor.prev = " ";
}

/** A body with nothing that could possibly be a marker, so it can be left
 *  exactly as it came rather than parsed and re-serialised. */
const NO_MENTIONS_RE = /<@|&lt;@|@everyone|@here/;

/**
 * Convert mention markers in a rendered body into chip spans.
 *
 * Called after `markdownToHtml`, on the send path, so what comes in is markup
 * this client just produced and what goes out is what every recipient stores.
 *
 * This used to be four regexes run over the HTML *string*, which cannot tell
 * text from markup. It rewrote inside attribute values - `<img alt="ping
 * @here">` came out with a `<span class="..."` spliced into the `alt`, closing
 * the attribute and corrupting the tag on its way to everyone in the channel -
 * and it disagreed with the receive side about what counts: a mention opening
 * a paragraph got no chip but did notify, and one inside a code span got the
 * reverse. Walking the parsed body fixes both at once, because text nodes are
 * the only thing it can reach and `code`/`pre` are skipped on both sides now.
 *
 * A body carrying nothing marker-shaped is returned untouched, so the ordinary
 * message never makes a round trip through the parser at all. Without a DOM
 * the body is returned as it came: no chips is a worse message, corrupted
 * markup is a worse client.
 */
export function applyMentionsToHtml(escapedHtml: string, resolver: MentionResolver): string {
  if (typeof DOMParser === "undefined") return escapedHtml;
  if (!NO_MENTIONS_RE.test(escapedHtml)) return escapedHtml;
  const doc = new DOMParser().parseFromString(escapedHtml, "text/html");
  const cursor: Cursor = { prev: null, changed: false };
  for (const child of Array.from(doc.body.childNodes)) chipNode(child, resolver, cursor);
  return cursor.changed ? doc.body.innerHTML : escapedHtml;
}

// -- Receive-side detection (notifications) ----------------------------

export interface MentionTargets {
  readonly sessions: ReadonlySet<number>;
  readonly roles: ReadonlySet<string>;
  readonly everyone: boolean;
  readonly here: boolean;
}

/** Elements whose contents are shown rather than said: what is inside them is
 *  quoted text, not the writer addressing anyone. */
const NOT_SPEECH: ReadonlySet<string> = new Set(["code", "pre"]);

/** The body as speech: its text, minus code, with block boundaries as spaces
 *  so a mention opening a paragraph still reads as one. */
function mentionScanText(html: string): string {
  return bodyToPlainText(html, { skip: NOT_SPEECH });
}

/** Extract the set of mention targets from a rendered HTML body. */
export function extractMentionTargets(html: string): MentionTargets {
  const sessions = new Set<number>();
  const roles = new Set<string>();
  let everyone = false;
  let here = false;

  for (const m of html.matchAll(/data-mention-session="(\d+)"/g)) {
    const n = Number(m[1]);
    if (Number.isFinite(n)) sessions.add(n);
  }
  for (const m of html.matchAll(/data-mention-role="([^"]*)"/g)) {
    // Written with `escapeHtml`, so read back through the inverse: the caller
    // compares these against real ACL group names, and `R&amp;D` matches none.
    roles.add(decodeEntities(m[1]));
  }
  if (/data-mention-everyone="1"/.test(html)) everyone = true;
  if (/data-mention-here="1"/.test(html)) here = true;

  // Also support legacy/raw markers in case the body wasn't run through
  // applyMentionsToHtml (e.g. messages from older clients).
  USER_MENTION_RE.lastIndex = 0;
  for (const m of html.matchAll(USER_MENTION_RE)) {
    sessions.add(Number(m[1]));
  }
  ROLE_MENTION_RE.lastIndex = 0;
  for (const m of html.matchAll(ROLE_MENTION_RE)) {
    roles.add(m[1]);
  }
  // `@everyone` written as text rather than sent as a chip - a legacy client,
  // a bridge, a bot. Read off the body's *text*, with code left out, because
  // the alternative (testing the raw HTML) pinged a whole channel for a
  // message that only quoted the word: "how do I use `@everyone`?" drew no
  // chip and notified everyone anyway. Skipping `code` and `pre` is also what
  // makes the rule agree with the renderer, which never chips inside them.
  const scan = mentionScanText(html);
  if (/(^|\s)@everyone\b/.test(scan)) everyone = true;
  if (/(^|\s)@here\b/.test(scan)) here = true;

  return { sessions, roles, everyone, here };
}

export interface SelfMentionContext {
  readonly ownSession: number | null;
  /** Group/role names the receiving user is a member of. */
  readonly ownRoles?: ReadonlySet<string>;
  /** True when the receiver is currently in the message's channel. */
  readonly isInMessageChannel: boolean;
}

/** Return true if the message body mentions the receiving user. */
export function containsSelfMention(html: string, ctx: SelfMentionContext): boolean {
  const targets = extractMentionTargets(html);
  if (ctx.ownSession != null && targets.sessions.has(ctx.ownSession)) {
    return true;
  }
  if (ctx.isInMessageChannel && (targets.everyone || targets.here)) {
    return true;
  }
  if (ctx.ownRoles && targets.roles.size > 0) {
    for (const role of targets.roles) {
      if (ctx.ownRoles.has(role)) return true;
    }
  }
  return false;
}

// -- Chip inspection (receive side) ------------------------------------

/** Every chip `applyMentionsToHtml` can emit, as one selector. */
export const MENTION_CHIP_SELECTOR =
  "[data-mention-session], [data-mention-role], [data-mention-everyone], [data-mention-here]";

/** What a chip in a rendered body points at. */
export type MentionChip =
  | { readonly kind: "user"; readonly session: number }
  | { readonly kind: "role"; readonly role: string }
  | { readonly kind: "everyone" }
  | { readonly kind: "here" };

/**
 * Read back the mention a chip element stands for.
 *
 * The attributes are written once, above, and read by every pack that renders
 * a message body, so which one means what is settled here rather than
 * separately in each design's message row.
 */
export function readMentionChip(el: HTMLElement): MentionChip | null {
  if (el.dataset.mentionSession) {
    const session = Number(el.dataset.mentionSession);
    return Number.isFinite(session) ? { kind: "user", session } : null;
  }
  if (el.dataset.mentionRole) return { kind: "role", role: el.dataset.mentionRole };
  if (el.dataset.mentionEveryone) return { kind: "everyone" };
  if (el.dataset.mentionHere) return { kind: "here" };
  return null;
}

// -- Who a mention stands for ------------------------------------------

/** Maximum number of members a role/everyone/here popover lists. */
export const MAX_DISPLAYED_MEMBERS = 30;

/**
 * The members an `@everyone`/`@here` chip stands for.
 *
 * The currently selected channel is the scope, matching how the renderer
 * treats `@everyone` - everyone in *this* channel, not on the server.
 */
export function membersForChannelMention(
  users: readonly UserEntry[],
  selectedChannel: number | null,
): readonly UserEntry[] {
  if (selectedChannel == null) return users;
  return users.filter((u) => u.channel_id === selectedChannel);
}

/** The connected members of a role, resolved through the root channel's ACL. */
export function membersForRole(
  users: readonly UserEntry[],
  groupName: string,
  groups: readonly AclGroup[],
): readonly UserEntry[] {
  const group = groups.find((g) => g.name === groupName);
  if (!group) return [];
  const memberIds = new Set<number>([...group.add, ...group.inherited_members]);
  for (const id of group.remove) memberIds.delete(id);
  return users.filter((u) => u.user_id != null && memberIds.has(u.user_id));
}
