import { useRef, useEffect, useLayoutEffect, useCallback, useState, useMemo } from "react";
import { useAppStore } from "../../store";
import type { ChatMessage } from "../../types";
import type { MessageScope } from "../../messageOffload";
import { useMessageOffload } from "./useMessageOffload";

/** One shared empty list, so an empty remainder never re-keys the offloader. */
const EMPTY_MESSAGES: readonly ChatMessage[] = [];
import {
  GROW_THRESHOLD_PX,
  grownDown,
  grownUp,
  initialWindow,
  isAtTail,
  SETTLE_SHRINK_MS,
  windowAfterAppend,
  windowAfterPrepend,
  windowAtTail,
  windowToInclude,
  type ThreadWindow,
} from "./chatWindowing";

/** Pixel threshold: user counts as "at the bottom" when within this. */
const NEAR_BOTTOM_PX = 120;

/**
 * The range a thread starts out with, before its messages are known.
 *
 * `end === 0` is the "unset" marker `resolved` below looks for: the window is
 * a range of absolute indices now, so it cannot be given a meaning until
 * there is a list for it to be a range *over*.
 */
const UNSET_WINDOW: ThreadWindow = { start: 0, end: 0 };

/** Returns true when the scrollable container is near the bottom. */
function isNearBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
}

/**
 * Stricter check: the user must be within half the visible viewport of the
 * bottom.  Used by auto-scroll triggers to avoid pulling the user down when
 * they have deliberately scrolled up.
 */
function isWithinHalfViewport(el: HTMLElement): boolean {
  const threshold = Math.max(el.clientHeight / 2, NEAR_BOTTOM_PX);
  return el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
}

interface UseChatScrollOptions {
  allMessages: ChatMessage[];
  selectedChannel: number | null;
  selectedDmUser: number | null;
  currentScope: () => MessageScope | null;
}

export function useChatScroll({
  allMessages,
  selectedChannel,
  selectedDmUser,
  currentScope,
}: UseChatScrollOptions) {
  /** The scroll container (<div.messages>). */
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  /** Bottom sentinel: always the last element inside the messages wrapper. */
  const bottomSentinelRef = useRef<HTMLDivElement>(null);

  /** Inner wrapper that grows with content. */
  const messagesInnerRef = useRef<HTMLDivElement>(null);

  /**
   * "Stick to bottom" flag.  When true, every content-height change
   * triggers an instant scroll to the bottom.
   */
  const stickToBottomRef = useRef(true);

  /**
   * Timestamp of the last programmatic scrollTo.  Scroll events within
   * 150 ms are not allowed to clear stickToBottomRef.
   */
  const lastProgrammaticScrollRef = useRef(0);

  /** Number of new (unread) messages received while scrolled up. */
  const [newMsgCount, setNewMsgCount] = useState(0);

  /**
   * The index in allMessages where a "new messages" divider should appear.
   * null = no divider.
   */
  const [lastReadIdx, setLastReadIdx] = useState<number | null>(null);

  /** Used to detect message count increases. */
  const prevMsgCountRef = useRef(0);

  /** Track the first message ID to detect history-prepend vs new-message-append. */
  const prevFirstMsgIdRef = useRef<string | null>(null);

  /**
   * Pending unread count captured when switching to a channel that had
   * unread messages.  Used to position the "new messages" divider on the
   * first message batch after the switch.
   */
  const pendingUnreadRef = useRef(0);

  // --- Two-sided render window (see chatWindowing.ts) ---------------
  // Only the rows inside `[start, end)` are mounted as DOM.  The window
  // grows at whichever edge the reader approaches, and comes back to the
  // tail when they settle at the bottom.  `end < total` means the newest
  // rows are *not* mounted, which is what keeps the DOM bounded however
  // far back somebody reads - and is why an arrival below the window has
  // to be announced rather than scrolled to.

  /** The mounted range, or [`UNSET_WINDOW`] before the thread is known. */
  const [range, setRange] = useState<ThreadWindow>(UNSET_WINDOW);

  /** Render-time mirrors so event handlers see current values without
   *  re-subscribing. */
  const allMessagesRef = useRef(allMessages);
  allMessagesRef.current = allMessages;

  /**
   * Which thread `range` was measured against.
   *
   * Indices only mean anything inside one conversation, and the reset below
   * runs in an effect - a frame after the new thread has already rendered.
   * Treating a range from the previous thread as unset is what stops that
   * frame from showing an arbitrary slice of the middle of this one.
   */
  const threadKey = `${selectedChannel ?? "-"}:${selectedDmUser ?? "-"}`;
  const rangeThreadRef = useRef("");
  const activeRange = rangeThreadRef.current === threadKey ? range : UNSET_WINDOW;

  // A page of older messages joined at the head: every mounted row keeps its
  // message but changes its index, so the range has to move with them or the
  // window would appear to jump backwards by exactly the size of the page.
  // Adjusted here rather than in an effect because React re-runs the component
  // before the browser paints, so the un-shifted window is never seen; done
  // from an effect it would be, for one frame, on every history fetch.
  // The identity check is what tells a prepend from any other list change:
  // the row that used to be the head has to sit exactly `shift` further down.
  const renderFirstIdRef = useRef<string | null>(null);
  const renderCountRef = useRef(0);
  const shift = allMessages.length - renderCountRef.current;
  if (
    shift > 0 &&
    activeRange.end > 0 &&
    renderFirstIdRef.current !== null &&
    allMessages[shift]?.message_id === renderFirstIdRef.current
  ) {
    setRange(windowAfterPrepend(activeRange, shift));
  }
  renderFirstIdRef.current = allMessages.length > 0 ? (allMessages[0].message_id ?? null) : null;
  renderCountRef.current = allMessages.length;

  /**
   * The range actually rendered: defaulted and clamped.
   *
   * A range is absolute where the old tail count was relative, so it needs
   * both.  An unset one has to resolve to the tail rather than to nothing -
   * the thread would render empty - and one left over from a longer thread
   * has to be brought back inside this one rather than slicing past its end.
   */
  const resolved = useMemo<ThreadWindow>(() => {
    const total = allMessages.length;
    if (total === 0) return UNSET_WINDOW;
    if (activeRange.end === 0 || activeRange.start >= total) {
      return initialWindow(total, pendingUnreadRef.current);
    }
    return { start: Math.min(activeRange.start, total), end: Math.min(activeRange.end, total) };
  }, [activeRange, allMessages.length]);
  const resolvedRef = useRef(resolved);
  resolvedRef.current = resolved;

  /**
   * Heavy bodies are handed to cold storage while they are out of view; the
   * set is the ones coming back right now.  See `useMessageOffload` - the rows
   * inside the window carry the two attributes it watches for, and the
   * messages the window leaves out are handed over directly.  Both sides of
   * it now: a reader scrolled up leaves rows *below* them unmounted, and
   * those bodies are exactly as heavy as the ones above.
   */
  const unmounted = useMemo(() => {
    if (resolved.start === 0 && resolved.end >= allMessages.length) return EMPTY_MESSAGES;
    return [...allMessages.slice(0, resolved.start), ...allMessages.slice(resolved.end)];
  }, [allMessages, resolved]);
  const { restoringKeys } = useMessageOffload({
    containerRef: messagesContainerRef,
    innerRef: messagesInnerRef,
    currentScope,
    unmounted,
  });

  /**
   * Where the viewport was pinned just before the window moved.
   *
   * The window moves at both edges now, so "how much taller did the content
   * get" is no longer enough on its own: a step that mounts rows above may
   * release rows below in the same commit, and one that mounts rows below may
   * release rows above.  Pinning a row that is actually on screen survives
   * either; the height difference stays as the fallback for a container that
   * has no rows to pin to (jsdom, or an empty thread).
   */
  const anchorRef = useRef<{ id: string | null; top: number; scrollHeight: number } | null>(null);

  /** Remember the topmost visible row, so the layout effect can put it back. */
  const captureAnchor = useCallback((el: HTMLElement) => {
    const containerTop = el.getBoundingClientRect().top;
    let id: string | null = null;
    let top = 0;
    for (const row of el.querySelectorAll<HTMLElement>("[data-msg-id]")) {
      const offset = row.getBoundingClientRect().top - containerTop;
      if (offset >= 0) {
        id = row.getAttribute("data-msg-id");
        top = offset;
        break;
      }
    }
    anchorRef.current = { id, top, scrollHeight: el.scrollHeight };
  }, []);

  /** Pending "the reader has come to rest at the bottom" snap-back. */
  const settleTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(settleTimerRef.current), []);

  /** Mount one more chunk of older messages above the current window. */
  const growUp = useCallback(
    (el: HTMLElement) => {
      if (anchorRef.current) return;
      const current = resolvedRef.current;
      if (current.start <= 0) return;
      captureAnchor(el);
      setRange(grownUp(current, allMessagesRef.current.length));
    },
    [captureAnchor],
  );

  /**
   * Mount one more chunk of newer messages below the current window.
   *
   * The other edge, and not optional: a reader who scrolled up far enough for
   * the window to release its tail can otherwise never scroll back to the
   * present, because the rows below them are not mounted and there is nothing
   * to scroll onto.
   */
  const growDown = useCallback(
    (el: HTMLElement) => {
      if (anchorRef.current) return;
      const total = allMessagesRef.current.length;
      const current = resolvedRef.current;
      if (isAtTail(current, total)) return;
      captureAnchor(el);
      setRange(grownDown(current, total));
    },
    [captureAnchor],
  );

  // Anchor the viewport after the window moved: the rows mounted (and the
  // ones released) change the height above the viewport, so put the row the
  // reader was looking at back where it was before paint.  If they are still
  // within the growth threshold afterwards (a fast drag to the very top),
  // grow again.
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    anchorRef.current = null;
    const el = messagesContainerRef.current;
    // Pinned to the bottom the browser keeps the view there by itself, and
    // the re-pin below does the rest; correcting as well would fight it.
    if (!el || stickToBottomRef.current) return;
    let corrected = false;
    if (anchor.id) {
      const row = el.querySelector<HTMLElement>(`[data-msg-id="${CSS.escape(anchor.id)}"]`);
      if (row) {
        const offset = row.getBoundingClientRect().top - el.getBoundingClientRect().top;
        el.scrollTop += offset - anchor.top;
        corrected = true;
      }
    }
    if (!corrected) {
      const diff = el.scrollHeight - anchor.scrollHeight;
      if (diff > 0) el.scrollTop += diff;
    }
    if (el.scrollTop < GROW_THRESHOLD_PX) growUp(el);
  }, [resolved.start, resolved.end, growUp]);

  /**
   * Mount the page of `delta` older messages that has just been prepended.
   *
   * The range has already moved with the shifted indices (during render,
   * above), so the same messages are still on screen and nothing has jumped.
   * What is left is to mount the page the reader asked for by scrolling to
   * the top, with the anchor keeping them where they are while it appears
   * above them.  A page that lands under a window further down the thread is
   * left alone: the shift was the whole of what it needed.
   */
  const handleHistoryPrepend = useCallback(
    (count: number, delta: number) => {
      const el = messagesContainerRef.current;
      if (!el) return;
      const current = resolvedRef.current;
      if (current.start > delta) return;
      captureAnchor(el);
      setRange(grownUp(current, count));
    },
    [captureAnchor],
  );

  /**
   * Make sure the message with `messageId` is inside the render window
   * (jump-to-quote, search, pinned-message navigation).  The caller
   * still has to wait a frame for React to mount the row.
   */
  const ensureMessageRendered = useCallback((messageId: string) => {
    const msgs = allMessagesRef.current;
    const idx = msgs.findIndex((m) => m.message_id === messageId);
    if (idx === -1) return;
    // Both edges may move: the target can be anywhere, including below a
    // window the reader has scrolled up past.
    setRange(windowToInclude(resolvedRef.current, idx, msgs.length));
  }, []);

  /** The slice of messages that is actually mounted. */
  const windowStart = resolved.start;
  const visibleMessages = useMemo(
    () =>
      resolved.start === 0 && resolved.end >= allMessages.length
        ? allMessages
        : allMessages.slice(resolved.start, resolved.end),
    [allMessages, resolved],
  );

  /** Instant scroll-to-bottom, updating the programmatic-scroll timestamp. */
  const scrollToBottom = useCallback((el: HTMLElement) => {
    stickToBottomRef.current = true;
    lastProgrammaticScrollRef.current = Date.now();
    const sentinel = bottomSentinelRef.current;
    if (sentinel) {
      sentinel.scrollIntoView({ behavior: "instant", block: "end" });
    } else {
      el.scrollTo({ top: el.scrollHeight, behavior: "instant" });
    }
  }, []);

  // Track scroll position and detect user scroll-away gestures.
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;

    const onScroll = () => {
      const total = allMessagesRef.current.length;
      // The bottom of the rendered content is only the present when the
      // window still reaches the newest row; below a detached window there
      // are messages the reader has not been shown.
      const atBottom = isNearBottom(el) && isAtTail(resolvedRef.current, total);
      if (atBottom) {
        stickToBottomRef.current = true;
        if (newMsgCount > 0) {
          setNewMsgCount(0);
          setLastReadIdx(null);
        }
      } else if (Date.now() - lastProgrammaticScrollRef.current > 150) {
        stickToBottomRef.current = false;
      }
      // Approaching the top of the rendered window while reading
      // history: mount the next chunk of older messages.
      // At most one edge per scroll. Both tests are true whenever the content
      // is shorter than two thresholds, and both handlers read the same range
      // out of a ref - so the second `setRange` overwrote the first and the
      // window sat still however far the reader moved. Nebula had the same
      // bug; a test there is what found it.
      if (!stickToBottomRef.current && el.scrollTop < GROW_THRESHOLD_PX) {
        growUp(el);
      } else if (el.scrollHeight - el.scrollTop - el.clientHeight < GROW_THRESHOLD_PX) {
        // Approaching the bottom of a window that has left the tail: mount the
        // next chunk of newer ones, so the way back to the present exists.
        growDown(el);
      }
      // Growth is otherwise one-way: a reader who climbed through a busy
      // channel and came back down keeps every row they passed, for as long
      // as the app is open.  Coming to rest at the bottom releases them, and
      // the rows released are all above the viewport.
      clearTimeout(settleTimerRef.current);
      if (stickToBottomRef.current) {
        settleTimerRef.current = setTimeout(() => {
          if (stickToBottomRef.current) setRange(windowAtTail(allMessagesRef.current.length));
        }, SETTLE_SHRINK_MS);
      }
    };

    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) stickToBottomRef.current = false;
    };

    let lastTouchY = 0;
    const onTouchStart = (e: TouchEvent) => {
      lastTouchY = e.touches[0].clientY;
    };
    const onTouchMove = (e: TouchEvent) => {
      const currentY = e.touches[0].clientY;
      if (currentY > lastTouchY + 5) stickToBottomRef.current = false;
      lastTouchY = currentY;
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
    };
  }, [newMsgCount, growUp, growDown]);

  // React to message-count changes.
  useEffect(() => {
    const count = allMessages.length;
    const delta = count - prevMsgCountRef.current;
    const prevCount = prevMsgCountRef.current;
    const prevFirstId = prevFirstMsgIdRef.current;
    const curFirstId = count > 0 ? (allMessages[0].message_id ?? null) : null;

    prevMsgCountRef.current = count;
    prevFirstMsgIdRef.current = curFirstId;

    if (delta <= 0) return;

    // Detect if older messages were prepended.
    if (prevFirstId !== null && curFirstId !== prevFirstId) {
      handleHistoryPrepend(count, delta);
      return;
    }

    const isInitialBatch = prevFirstId === null;
    const el = messagesContainerRef.current;

    // On the first batch after a channel switch, place the "new messages"
    // divider if there were pending unreads.
    if (isInitialBatch && pendingUnreadRef.current > 0 && count > pendingUnreadRef.current) {
      const pending = pendingUnreadRef.current;
      const dividerIdx = count - pending;
      // Pin the window the resolver was defaulting to, before the pending
      // count that shaped it is cleared.
      setRange(initialWindow(count, pending));
      pendingUnreadRef.current = 0;
      setLastReadIdx(dividerIdx);
      setNewMsgCount(pending);

      stickToBottomRef.current = false;
      requestAnimationFrame(() => {
        if (!el) return;
        const dividerEl = el.querySelector('[aria-label="New messages"]');
        if (dividerEl) {
          dividerEl.scrollIntoView({ behavior: "instant", block: "center" });
        } else {
          scrollToBottom(el);
        }
      });
      return;
    }
    pendingUnreadRef.current = 0;

    let atBottom: boolean;
    if (isInitialBatch) {
      atBottom = stickToBottomRef.current;
    } else {
      atBottom = el ? isWithinHalfViewport(el) : stickToBottomRef.current;
    }

    // Arrivals are followed down only when the reader is at the bottom *and*
    // the window still reached the newest row.  Otherwise the range stays
    // exactly where it is - moving it would shift what the reader is looking
    // at to show them something they did not ask to see - and the message is
    // announced by the pill instead.
    const followed = atBottom && isAtTail(resolvedRef.current, prevCount);
    setRange(windowAfterAppend(resolvedRef.current, count, followed));

    if (followed) {
      stickToBottomRef.current = true;
      requestAnimationFrame(() => {
        if (el) scrollToBottom(el);
      });
    } else {
      stickToBottomRef.current = false;
      setLastReadIdx((prev) => prev ?? count - delta);
      setNewMsgCount((prev) => prev + delta);
    }
  }, [allMessages, scrollToBottom, handleHistoryPrepend]);

  // Re-pin after images / media load.
  useEffect(() => {
    const outer = messagesContainerRef.current;
    const inner = messagesInnerRef.current;
    if (!outer || !inner) return;

    const repin = () => {
      if (!stickToBottomRef.current) return;
      requestAnimationFrame(() => {
        if (!stickToBottomRef.current) return;
        lastProgrammaticScrollRef.current = Date.now();
        const sentinel = bottomSentinelRef.current;
        if (sentinel) {
          sentinel.scrollIntoView({ behavior: "instant", block: "end" });
        } else {
          outer.scrollTo({ top: outer.scrollHeight, behavior: "instant" });
        }
      });
    };

    const resizeObs = new ResizeObserver(repin);
    resizeObs.observe(inner);

    const trackedImages = new WeakSet<HTMLImageElement>();
    const trackedVideos = new WeakSet<HTMLVideoElement>();

    const trackImages = () => {
      for (const img of inner.querySelectorAll<HTMLImageElement>("img")) {
        if (trackedImages.has(img)) continue;
        trackedImages.add(img);
        if (!img.complete) {
          img.addEventListener("load", repin, { once: true });
        }
      }
      for (const vid of inner.querySelectorAll<HTMLVideoElement>("video")) {
        if (trackedVideos.has(vid)) continue;
        trackedVideos.add(vid);
        vid.addEventListener("loadedmetadata", repin, { once: true });
      }
    };

    trackImages();

    const mutObs = new MutationObserver(() => {
      trackImages();
      repin();
    });
    mutObs.observe(inner, { childList: true, subtree: true });

    return () => {
      resizeObs.disconnect();
      mutObs.disconnect();
    };
  }, []);

  // On channel / DM switch, reset scroll state.
  // Capture the pending unread count so the initial message batch can
  // place the "new messages" divider at the correct position.
  useEffect(() => {
    const { unreadCounts, dmUnreadCounts } = useAppStore.getState();
    if (selectedChannel !== null) {
      pendingUnreadRef.current = unreadCounts[selectedChannel] ?? 0;
    } else if (selectedDmUser !== null) {
      pendingUnreadRef.current = dmUnreadCounts[selectedDmUser] ?? 0;
    } else {
      pendingUnreadRef.current = 0;
    }

    setNewMsgCount(0);
    setLastReadIdx(null);
    // Reset to zero/null so the next message load is detected as an
    // initial batch (prevFirstId === null).
    prevMsgCountRef.current = 0;
    prevFirstMsgIdRef.current = null;
    stickToBottomRef.current = pendingUnreadRef.current === 0;
    // Fresh render window: unset, so the first batch of the new thread
    // resolves to its tail, plus room for the "new messages" divider.
    anchorRef.current = null;
    rangeThreadRef.current = threadKey;
    setRange(UNSET_WINDOW);
  }, [selectedChannel, selectedDmUser, threadKey]);

  /** Jump-to-bottom handler used by the "new messages" pill. */
  const handleScrollToBottom = useCallback(() => {
    const el = messagesContainerRef.current;
    setNewMsgCount(0);
    setLastReadIdx(null);
    // Leaving history behind - the window snaps back to the tail, which is
    // also what mounts the arrivals the pill was announcing.
    anchorRef.current = null;
    setRange(windowAtTail(allMessagesRef.current.length));
    if (el) scrollToBottom(el);
  }, [scrollToBottom]);

  return {
    messagesContainerRef,
    bottomSentinelRef,
    messagesInnerRef,
    newMsgCount,
    lastReadIdx,
    restoringKeys,
    handleScrollToBottom,
    /** Mounted slice of `allMessages` (two-sided render window). */
    visibleMessages,
    /** Global index of `visibleMessages[0]` within `allMessages`. */
    windowStart,
    ensureMessageRendered,
  };
}
