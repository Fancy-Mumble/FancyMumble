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
