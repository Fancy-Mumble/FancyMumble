/**
 * What the pinned panel shows, derived from the messages it was handed.
 *
 * Pure functions, so the two decisions the panel actually makes - what a pin
 * reads as in two lines, and how long ago it was written - are testable
 * without mounting a popover. The panel draws; this decides.
 */
import type { useTranslation } from "react-i18next";
import type { ChatMessage } from "@core/types";
import { formatTime, messageContent, type TimeDisplay } from "../../../selectors";

/**
 * The `t` the label-producing helpers take.
 *
 * Same shape as `SelectorT`, bound to the pack's chat namespace instead: the
 * age words are the pinned panel's own and mean nothing outside it.
 */
export type PinnedT = ReturnType<typeof useTranslation<"nebulaChat">>["t"];

/** One run of a preview: prose, or a code span kept whole. */
export interface PreviewRun {
  text: string;
  /** Drawn in the mono face - the mock keeps a pinned address readable. */
  code: boolean;
}

export interface PinPreview {
  /** The body reduced to one paragraph, in order. */
  runs: PreviewRun[];
  /** First image in the body, drawn as the row's thumbnail. */
  image: string | null;
  /** What the body is, for the rows whose text is empty. */
  kind: "text" | "poll" | "file";
}

/**
 * How much of a body a row shows.
 *
 * Two lines at the panel's width, plus enough slack that a clamped third line
 * is what the ellipsis lands in rather than a word torn off mid-sentence.
 */
const MAX_PREVIEW = 160;

/**
 * A pinned message reduced to what a row can hold.
 *
 * Bodies are HTML, and the panel renders text rather than markup - so this
 * flattens rather than sanitising, which is also why the row can never inherit
 * a message's layout. Code spans survive as their own runs because the thing
 * people pin most is an address or a command, and a server address set in the
 * body face is the one part of a preview that has to be read character by
 * character.
 */
export function pinPreview(body: string): PinPreview {
  const content = messageContent(body);
  // No DOM to parse with (a non-jsdom unit environment): the raw body is a
  // worse preview than a parsed one and a better one than nothing.
  if (typeof DOMParser === "undefined") {
    return { runs: [{ text: content.html, code: false }], image: null, kind: content.kind };
  }

  const doc = new DOMParser().parseFromString(content.html, "text/html");
  const image = doc.querySelector("img")?.getAttribute("src") ?? null;

  const runs: PreviewRun[] = [];
  collect(doc.body, false, runs);
  const first = runs[0];
  if (first) first.text = first.text.trimStart();
  const last = runs.at(-1);
  if (last) last.text = last.text.trimEnd();

  return { runs: clamp(runs.filter((run) => run.text !== "")), image, kind: content.kind };
}

/** Flatten an element's text, marking whatever sits inside `code` or `pre`. */
function collect(node: Node, code: boolean, runs: PreviewRun[]): void {
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      push(runs, child.textContent ?? "", code);
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const tag = (child as Element).tagName.toLowerCase();
    // A line break is a word gap here: the row is one paragraph however many
    // the message was written as.
    if (tag === "br") {
      push(runs, " ", code);
      continue;
    }
    collect(child, code || tag === "code" || tag === "pre", runs);
    if (BLOCK_TAGS.has(tag)) push(runs, " ", false);
  }
}

const BLOCK_TAGS = new Set(["p", "div", "li", "blockquote", "pre", "h1", "h2", "h3", "h4", "h5", "h6"]);

function push(runs: PreviewRun[], raw: string, code: boolean): void {
  const text = raw.replaceAll(/\s+/g, " ");
  if (text === "") return;
  const open = runs.at(-1);
  // Merged rather than appended, so a body of ten inline elements is not ten
  // spans the row has to lay out.
  if (open && open.code === code) {
    if (open.text.endsWith(" ") && text === " ") return;
    open.text += text;
    return;
  }
  runs.push({ text, code });
}

/** Cut the runs to the row's budget, ellipsising whatever the cut lands in. */
function clamp(runs: PreviewRun[]): PreviewRun[] {
  const total = runs.reduce((sum, run) => sum + run.text.length, 0);
  if (total <= MAX_PREVIEW) return runs;

  const kept: PreviewRun[] = [];
  let used = 0;
  for (const run of runs) {
    if (used >= MAX_PREVIEW) break;
    kept.push({ ...run, text: run.text.slice(0, MAX_PREVIEW - used) });
    used += run.text.length;
  }
  const last = kept.at(-1);
  if (last) last.text = last.text.trimEnd() + "…";
  return kept;
}

/** The moment a pin is filed under: when it was written, else when it was pinned. */
export function pinTime(message: ChatMessage): number {
  return message.timestamp ?? message.pinned_at ?? 0;
}

/**
 * The channel's pins, newest first.
 *
 * Ordered by the same stamp the rows print, so the list reads top to bottom as
 * the times beside the names say it should - the store hands them over in
 * conversation order, which puts the oldest pin at the top of a panel that is
 * scanned for the newest.
 *
 * A pin with no message id is dropped rather than drawn: jumping to it is the
 * row's whole purpose, and the id is what a jump aims at.
 */
export function pinnedMessages(messages: readonly ChatMessage[]): ChatMessage[] {
  return messages
    .filter((message) => message.pinned && !!message.message_id)
    .sort((left, right) => pinTime(right) - pinTime(left));
}

/** Local midnight of the day a stamp falls in. */
function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * How long ago a pin was written, in the shortest form still worth reading.
 *
 * A pin list is scanned for "is this still current?", so the answer coarsens
 * as it ages: a clock time today, a weekday and a clock time this week, and
 * beyond that a bare interval - "2 weeks ago" is what the reader wants from
 * something a fortnight old, and the hour it was sent at is noise. Past a
 * month the interval stops being informative and a date takes over.
 */
export function pinAge(
  t: PinnedT,
  timestamp: number | null | undefined,
  display: TimeDisplay,
  now: number = Date.now(),
): string {
  if (!timestamp) return "";
  const time = formatTime(timestamp, display);
  const days = Math.round((startOfDay(now) - startOfDay(timestamp)) / 86_400_000);

  if (days <= 0) return time;
  if (days === 1) return t("pinned.age.yesterday", { time });
  if (days < 7) {
    const day = new Date(timestamp).toLocaleDateString(undefined, { weekday: "short" });
    return t("pinned.age.weekday", { day, time });
  }
  if (days < 14) return t("pinned.age.lastWeek");
  if (days < 28) return t("pinned.age.weeksAgo", { count: Math.floor(days / 7) });
  return new Date(timestamp).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
