/**
 * Tail-anchored message windowing for the chat list.
 *
 * Instead of mounting every in-memory message (up to 500 per thread) as
 * live DOM, only the most recent `tailCount` messages render.  The window
 * is anchored to the *end* of the list:
 *
 *   - it starts at [`BASE_WINDOW`] messages (plus enough context to show
 *     the "new messages" divider when switching into an unread channel),
 *   - it grows in [`WINDOW_GROW_CHUNK`] steps as the user scrolls toward
 *     the top of the rendered content,
 *   - while the user is scrolled up it grows with every appended message
 *     so the rendered content above the viewport never shifts, and
 *   - it snaps back to [`BASE_WINDOW`] when the user is back at the
 *     bottom (new message while pinned, or jump-to-bottom).
 *
 * This keeps the scroll container native, so the battle-tested scroll
 * state machine (stick-to-bottom, image re-pin, offload viewport
 * tracking - see ChatViewAutoScroll.test.ts) operates unchanged on the
 * rendered slice.  These helpers are pure so the sizing policy is unit
 * testable without DOM.
 */

/** Number of trailing messages rendered when at the bottom of a thread. */
export const BASE_WINDOW = 100;

/** How many more messages are rendered per near-top growth step. */
export const WINDOW_GROW_CHUNK = 100;

/** Scroll-distance (px) from the top of the rendered content that
 *  triggers a growth step. */
export const GROW_THRESHOLD_PX = 600;

/** Messages of context rendered above the "new messages" divider /
 *  above a jump-to-message target. */
const CONTEXT_ABOVE = 20;

/** Window size when entering a thread: covers all unread messages plus
 *  some context above the divider. */
export function initialTailCount(pendingUnread: number): number {
  return Math.max(BASE_WINDOW, pendingUnread + CONTEXT_ABOVE);
}

/**
 * Window size after `appended` new messages arrive at the tail.
 *
 * At the bottom the window snaps back to the base size (the reader has
 * left history behind).  Scrolled up it must grow by the same amount so
 * the window keeps starting at the same message - otherwise every
 * arrival would unmount rows above the viewport and shift the content
 * the user is reading.
 */
export function tailCountAfterAppend(prev: number, appended: number, atBottom: boolean): number {
  return atBottom ? BASE_WINDOW : prev + appended;
}

/** Window size after one near-top growth step, capped at the list size. */
export function grownTailCount(prev: number, total: number): number {
  return Math.min(total, prev + WINDOW_GROW_CHUNK);
}

/**
 * How long the reader has to sit at the bottom before the window lets the
 * history above go.
 *
 * Long enough that flicking to the bottom and straight back up finds the rows
 * still mounted, short enough that a conversation someone has scrolled through
 * and left alone does not keep hundreds of rows for the rest of the session.
 */
export const SETTLE_SHRINK_MS = 2_000;

/**
 * Window size once the reader has settled back at the bottom.
 *
 * Growth was one-way: climbing towards the top mounted chunk after chunk, and
 * only an *arriving* message ever snapped the window back
 * ([`tailCountAfterAppend`]). A reader who scrolled up through a busy channel
 * and came back down kept every row they had passed - in a quiet channel, for
 * as long as the app was open. Coming to rest at the bottom is the same
 * signal an arrival gives: the history above is no longer being read.
 *
 * Only ever shrinks, and only from the bottom, so the rows released are all
 * above the viewport and the view does not move.
 */
export function settledTailCount(prev: number): number {
  return Math.min(prev, BASE_WINDOW);
}

/**
 * Window size needed to render the message at `msgIdx` (plus context
 * above it), e.g. for jump-to-quote / search navigation.  Never shrinks.
 */
export function tailCountToInclude(prev: number, msgIdx: number, total: number): number {
  const needed = Math.min(total, total - msgIdx + CONTEXT_ABOVE);
  return Math.max(prev, needed);
}

/* ------------------------------------------------------------------ *
 * Two-sided windowing
 *
 * Everything above anchors the window to the tail: it grows toward the top
 * and the newest message is always mounted. That is the right model while
 * the reader is near the bottom, and the wrong one as soon as they are not.
 * A reader who has scrolled up through a long channel keeps every row
 * between them and the present mounted, which is the cost the tail anchor
 * was supposed to avoid, just moved to the other end.
 *
 * A two-sided window is a range `[start, end)` over the rows the host gave
 * us. `end < total` means the newest rows are *not* mounted, which is what
 * lets the DOM stay bounded no matter how far back somebody reads — and it
 * is also why the reader has to be told: a message arriving below a window
 * that does not reach the tail must not silently scroll them.
 * ------------------------------------------------------------------ */

/** A half-open range of row indices that are mounted. */
export interface ThreadWindow {
  /** First mounted row, inclusive. */
  start: number;
  /** One past the last mounted row. */
  end: number;
}

/** The window a thread opens at: the tail, plus room for the unread divider. */
export function initialWindow(total: number, pendingUnread: number): ThreadWindow {
  const size = initialTailCount(pendingUnread);
  return { start: Math.max(0, total - size), end: total };
}

/** Whether `window` reaches the newest row, and so should follow arrivals down. */
export function isAtTail(window: ThreadWindow, total: number): boolean {
  return window.end >= total;
}

/**
 * Grow the window toward the top by one chunk.
 *
 * The far edge comes with it once the window is at its full size, so reading
 * backwards costs a bounded number of mounted rows rather than an unbounded
 * one. That trailing release is the whole difference from the tail-anchored
 * model, and it is only safe because the rows released are below the viewport
 * and can be fetched back.
 */
export function grownUp(window: ThreadWindow, total: number): ThreadWindow {
  const start = Math.max(0, window.start - WINDOW_GROW_CHUNK);
  const size = window.end - start;
  const end = size > MAX_MOUNTED ? Math.min(total, start + MAX_MOUNTED) : window.end;
  return { start, end };
}

/** Grow the window toward the bottom by one chunk, releasing the head to match. */
export function grownDown(window: ThreadWindow, total: number): ThreadWindow {
  const end = Math.min(total, window.end + WINDOW_GROW_CHUNK);
  const size = end - window.start;
  const start = size > MAX_MOUNTED ? Math.max(0, end - MAX_MOUNTED) : window.start;
  return { start, end };
}

/**
 * The most rows that may be mounted at once.
 *
 * Not a memory figure so much as a layout one: past a few hundred rows the
 * browser's own layout and the offload observers cost more per scroll step
 * than fetching a page back does.
 */
export const MAX_MOUNTED = 300;

/**
 * The window after rows have arrived at the tail, `total` counting them.
 *
 * Only follows them down when the window was already at the tail. Otherwise
 * the range is left exactly where it is, because moving it would shift what
 * the reader is looking at to show them something they have not asked to see;
 * the caller shows a "new messages" affordance instead.
 */
export function windowAfterAppend(window: ThreadWindow, total: number, wasAtTail: boolean): ThreadWindow {
  if (!wasAtTail) return window;
  const end = total;
  const start = Math.max(0, end - Math.max(BASE_WINDOW, window.end - window.start));
  return { start, end };
}

/**
 * The window after a page of `count` older rows is joined at the head.
 *
 * The indices of everything already mounted shift by `count`, so the window
 * has to shift with them or it would appear to jump backwards by exactly the
 * size of the page that just arrived.
 */
export function windowAfterPrepend(window: ThreadWindow, count: number): ThreadWindow {
  return { start: window.start + count, end: window.end + count };
}

/** The window snapped back to the tail, for jump-to-bottom. */
export function windowAtTail(total: number): ThreadWindow {
  return { start: Math.max(0, total - BASE_WINDOW), end: total };
}

/**
 * The window widened to cover row `index`, plus context above it.
 *
 * For jump-to-quote and search. Unlike the tail-anchored version this may move
 * *both* edges, because the target can be anywhere — including below a window
 * the reader has scrolled up past.
 */
export function windowToInclude(window: ThreadWindow, index: number, total: number): ThreadWindow {
  if (index >= window.start && index < window.end) return window;
  const start = Math.max(0, index - CONTEXT_ABOVE);
  const end = Math.min(total, Math.max(index + 1, start + BASE_WINDOW));
  return { start, end };
}
