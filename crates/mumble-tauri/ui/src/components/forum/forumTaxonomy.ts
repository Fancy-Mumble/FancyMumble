/**
 * Client-side taxonomy + title-encoding helpers that turn the flat, per-channel
 * forum posts into a classic "Category -> Topic -> Thread -> Posts" board.
 *
 * The server only stores a thread as a root post with a free-form `title`. To
 * layer a forum hierarchy on top of that without any protocol or database
 * change, we pack the board coordinates into the root title as
 *
 *     "<category><topic><thread title>"
 *
 * using the ASCII Unit Separator (0x1F), which never appears in user-entered
 * text. `encodeThreadTitle` packs it for new threads; `parseThreadTitle`
 * unpacks it, dropping legacy/plain titles into a sensible default board.
 */

import type { ForumPost } from "./forumStore";

/** Field separator packed into a thread root's title (ASCII Unit Separator). */
export const FORUM_SEP = "\u001F";

export interface ThreadCoords {
  category: string;
  topic: string;
  /** Compact flag string, e.g. "PL" for pinned+locked. See FLAG_* below. */
  flags: string;
  title: string;
}

/** Thread is pinned (sorted first, shown with a pin badge). */
export const FLAG_PINNED = "P";
/** Thread is locked: no new replies (moderator-enforced client-side only). */
export const FLAG_LOCKED = "L";

export function isPinned(flags: string): boolean {
  return flags.includes(FLAG_PINNED);
}

export function isLocked(flags: string): boolean {
  return flags.includes(FLAG_LOCKED);
}

/** Add or remove a single-character flag from a flag string, keeping it deterministic. */
export function withFlag(flags: string, flag: string, on: boolean): string {
  const set = new Set(flags.split("").filter(Boolean));
  if (on) set.add(flag);
  else set.delete(flag);
  // Stable order: pinned before locked, regardless of toggle order.
  return [FLAG_PINNED, FLAG_LOCKED].filter((f) => set.has(f)).join("");
}

export interface TopicDef {
  name: string;
  description: string;
}

export interface CategoryDef {
  name: string;
  topics: TopicDef[];
}

/**
 * Default board layout. Always rendered so the forum looks like a real board
 * index even before anyone posts. Threads may also introduce their own
 * categories/topics, which are appended after these defaults.
 */
export const DEFAULT_TAXONOMY: readonly CategoryDef[] = [
  {
    name: "Community",
    topics: [
      { name: "Announcements", description: "News and official updates from the server staff." },
      { name: "General Discussion", description: "Talk about anything and everything here." },
      { name: "Introductions", description: "New to the server? Say hello and introduce yourself." },
    ],
  },
  {
    name: "Support",
    topics: [
      { name: "Help & Questions", description: "Get help using the server and its features." },
      { name: "Bug Reports", description: "Spotted something broken? Let us know here." },
    ],
  },
  {
    name: "Off-Topic",
    topics: [
      { name: "The Lounge", description: "Off-topic chatter, memes and general hangouts." },
      { name: "Gaming", description: "Find a squad and talk about the games you play." },
    ],
  },
];

const DEFAULT_CATEGORY = DEFAULT_TAXONOMY[0].name; // "Community"
const DEFAULT_TOPIC = DEFAULT_TAXONOMY[0].topics[1].name; // "General Discussion"

/**
 * Pack board coordinates into a thread root title for a new thread.
 *
 * Always emits the 4-segment "category<SEP>topic<SEP>flags<SEP>title" form,
 * which `parseThreadTitle` distinguishes from the legacy 3-segment
 * "category<SEP>topic<SEP>title" form (no flags) written before pin/lock
 * existed - both forms are stable since user text never contains the raw
 * unit-separator byte.
 */
export function encodeThreadTitle(category: string, topic: string, title: string, flags = ""): string {
  return [category, topic, flags, title].join(FORUM_SEP);
}

/** Unpack a thread root title into its board coordinates + display title. */
export function parseThreadTitle(raw: string | undefined): ThreadCoords {
  const parts = (raw ?? "").split(FORUM_SEP);
  if (parts.length >= 4) {
    return {
      category: parts[0] || DEFAULT_CATEGORY,
      topic: parts[1] || DEFAULT_TOPIC,
      flags: parts[2] || "",
      title: parts.slice(3).join(FORUM_SEP) || "",
    };
  }
  if (parts.length === 3) {
    // Pre-pin/lock thread: category + topic, no flags segment.
    return { category: parts[0] || DEFAULT_CATEGORY, topic: parts[1] || DEFAULT_TOPIC, flags: "", title: parts[2] || "" };
  }
  // Legacy / plain thread: file it under the default board so it stays visible.
  return { category: DEFAULT_CATEGORY, topic: DEFAULT_TOPIC, flags: "", title: raw ?? "" };
}

function activity(p: ForumPost): number {
  return p.editedAt ?? p.createdAt ?? 0;
}

export interface TopicView {
  category: string;
  name: string;
  description: string;
  /** Thread roots in this topic, most-recently-active first. */
  threads: ForumPost[];
  threadCount: number;
  /** Total replies across the topic's threads. */
  postCount: number;
  lastPost?: { authorName?: string; at: number };
}

export interface CategoryView {
  name: string;
  topics: TopicView[];
}

/**
 * Group thread roots into the Category -> Topic board, seeded with the default
 * taxonomy so empty boards still show, then augmented with any custom
 * categories/topics discovered on real threads.
 */
export function buildBoard(roots: ForumPost[]): CategoryView[] {
  const key = (c: string, t: string) => c + FORUM_SEP + t;

  const threadsByKey = new Map<string, ForumPost[]>();
  for (const r of roots) {
    const { category, topic } = parseThreadTitle(r.title);
    const k = key(category, topic);
    const arr = threadsByKey.get(k);
    if (arr) arr.push(r);
    else threadsByKey.set(k, [r]);
  }

  const catOrder: string[] = [];
  const topicsByCat = new Map<string, TopicView[]>();
  const seen = new Set<string>();

  const addTopic = (category: string, name: string, description: string) => {
    const k = key(category, name);
    if (seen.has(k)) return;
    seen.add(k);
    const byActivity = (threadsByKey.get(k) ?? []).slice().sort((a, b) => activity(b) - activity(a));
    const last = byActivity[0];
    // Pinned threads float to the top of the topic; ties keep activity order.
    const threads = byActivity.slice().sort((a, b) => {
      const ap = isPinned(parseThreadTitle(a.title).flags) ? 1 : 0;
      const bp = isPinned(parseThreadTitle(b.title).flags) ? 1 : 0;
      return ap !== bp ? bp - ap : activity(b) - activity(a);
    });
    if (!topicsByCat.has(category)) {
      topicsByCat.set(category, []);
      catOrder.push(category);
    }
    topicsByCat.get(category)!.push({
      category,
      name,
      description,
      threads,
      threadCount: threads.length,
      postCount: threads.reduce((n, t) => n + (t.replyCount || 0), 0),
      lastPost: last ? { authorName: last.authorName, at: activity(last) } : undefined,
    });
  };

  // 1. Defaults first, in their declared order.
  for (const cat of DEFAULT_TAXONOMY) {
    for (const tp of cat.topics) addTopic(cat.name, tp.name, tp.description);
  }
  // 2. Any custom categories/topics carried by real threads.
  for (const r of roots) {
    const { category, topic } = parseThreadTitle(r.title);
    addTopic(category, topic, "");
  }

  return catOrder.map((name) => ({ name, topics: topicsByCat.get(name)! }));
}
