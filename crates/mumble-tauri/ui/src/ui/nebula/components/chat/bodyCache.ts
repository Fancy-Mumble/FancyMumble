/**
 * What a message body turns into, worked out once per body.
 *
 * Drawing a message means reading its markup apart several times over: what
 * kind of message it is, which pictures come out of it into the gallery, what
 * survives sanitising, and which links are shown short. Each of those parses
 * the HTML again, so a row costs four to six passes over its own body before it
 * draws anything.
 *
 * Within one mounted row that is paid once, because each step is memoised
 * against the last. Across mounts it was paid every time - and the river
 * unmounts rows constantly: the render window slides as the reader scrolls, and
 * climbing towards the top mounts a hundred more in a single step. A body that
 * scrolled out of view and back in was read apart from scratch, the second time
 * producing exactly what it produced the first.
 *
 * A message body is an immutable string, so the answer for one is the answer
 * forever. This keeps the last thousand of them.
 */
import { messageContent, splitBodyImages, type BodyImage, type MessageContent } from "../../selectors";

/** Everything the row needs from the raw body, in one piece. */
export interface ParsedBody {
  /** What the message *is* - prose, a poll, a file, a set of quotes. */
  content: MessageContent;
  /** The prose, sanitised and with long links shortened for display. */
  html: string;
  /** The pictures lifted out of the body, for the gallery below it. */
  images: BodyImage[];
}

/**
 * How many bodies to keep.
 *
 * Generous, because the entries are small - the parsed output of a body is the
 * same order of size as the body - and because the point is to survive a reader
 * scrolling up through history and back down again, which can easily pass a few
 * hundred messages.
 */
const LIMIT = 1000;

/**
 * Insertion-ordered, which a `Map` already is, so the oldest entry is the first
 * one iteration yields. Re-inserting on a hit is what makes it least-recently-
 * used rather than first-in-first-out.
 */
const cache = new Map<string, ParsedBody>();

/**
 * Read a body apart, or hand back the last time it was read apart.
 *
 * `sanitize` is passed in rather than imported: it is the row's own recipe -
 * which attributes survive, which hrefs are struck out, how an external link is
 * marked - and this module has no opinion about any of that. It is called only
 * on a miss, so the cost it carries is paid once per distinct body.
 */
export function parseBody(body: string, sanitize: (html: string) => string): ParsedBody {
  const hit = cache.get(body);
  if (hit) {
    // Most recently used: move it to the end of the insertion order.
    cache.delete(body);
    cache.set(body, hit);
    return hit;
  }

  const content = messageContent(body);
  const split = splitBodyImages(content.html);
  const parsed: ParsedBody = { content, html: sanitize(split.html), images: split.images };

  cache.set(body, parsed);
  if (cache.size > LIMIT) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  return parsed;
}

/** Forget everything. For the tests, and for a session ending. */
export function clearBodyCache(): void {
  cache.clear();
}

/** How many bodies are being held. For the tests. */
export function bodyCacheSize(): number {
  return cache.size;
}
