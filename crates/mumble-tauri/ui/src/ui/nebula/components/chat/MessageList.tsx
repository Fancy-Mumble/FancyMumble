import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Stack } from "../primitives";
import { Box, Divider, Typography } from "@mui/material";
import { useUserAvatars } from "@core/lazyBlobs";
import type { ChatMessage, UserEntry } from "@core/types";
import {
  BASE_WINDOW,
  GROW_THRESHOLD_PX,
  grownTailCount,
  settledTailCount,
  SETTLE_SHRINK_MS,
  tailCountAfterAppend,
  tailCountToInclude,
} from "@core/features/chat/chatWindowing";
import { useMessageOffload } from "@core/features/chat/useMessageOffload";
import { isHeavyContent, type MessageScope } from "@core/messageOffload";
import { groupMessagesByDay } from "../../selectors";

/** One shared empty list, so an empty remainder never re-keys the offloader. */
const EMPTY_MESSAGES: readonly ChatMessage[] = [];
import { DEFAULT_CHAT_DISPLAY, type ChatDisplay } from "../../useChatDisplay";
import { CHAT_COLUMN_INSET_PX, CHAT_COLUMN_MAX_WIDTH, radius } from "../../tokens";

/**
 * The name the scroller publishes its scrollbar's width under.
 *
 * The composer is not inside the scroller, so it is the one element in the
 * pane that has no scrollbar taking width off it - and a river that stops a
 * scrollbar short of the box below it is the mismatch this measures away.
 * Read as `var(--nebula-chat-gutter)` by whatever has to match this column.
 */
const GUTTER_VAR = "--nebula-chat-gutter";

interface MessageListProps {
  messages: readonly ChatMessage[];
  /** Live users, used to resolve sender avatars in one batched fetch. */
  users: readonly UserEntry[];
  /** Message id the unread divider is drawn above, if any. */
  firstUnreadId?: string | null;
  /**
   * Drawn above the oldest message, inside the scroller.
   *
   * This is where the persistence banner goes, and it has to be *inside*:
   * the banner carries the pagination sentinel, and an observer watching an
   * element that is permanently on screen fires the moment there is more
   * history and keeps firing until there is none.
   */
  header?: React.ReactNode;
  /**
   * Message to bring into view, and a nonce so asking twice for the same one
   * still scrolls. Following a quote to a message you are already looking at
   * has to flash it again, or the click reads as broken.
   */
  jumpTo?: { messageId: string; nonce: number } | null;
  /**
   * Text size and density, from the personalization record.
   *
   * The size is set on the column rather than on each row: the rows draw their
   * bodies at the inherited size, and their own furniture - names, timestamps,
   * badges - is chrome that the mock sizes rather than the reader.
   */
  display?: ChatDisplay;
  /**
   * The open conversation, for cold storage.
   *
   * A body worth megabytes is written to an encrypted temp file while it is
   * out of view and read back before the reader returns to it, and the scope
   * is what the two halves are keyed by. Omitting it leaves every body in
   * memory, which is what a list drawn outside a conversation wants.
   */
  currentScope?: () => MessageScope | null;
  renderMessage: (
    message: ChatMessage,
    avatar: string | null,
    grouped: boolean,
    /** Its body is in cold storage and on its way back - draw a placeholder. */
    restoring: boolean,
    /** Nothing below it belongs to the same block - it carries the timestamp. */
    endsGroup: boolean,
  ) => React.ReactNode;
}

/** Consecutive messages from one sender collapse into a single block. */
const GROUP_WINDOW_MS = 5 * 60 * 1000;

/** Stable "no conversation", so the default does not re-arm the observer. */
const NO_SCOPE = (): MessageScope | null => null;

function isGrouped(message: ChatMessage, previous: ChatMessage | undefined): boolean {
  if (!previous) return false;
  if (previous.sender_session !== message.sender_session) return false;
  if (previous.is_own !== message.is_own) return false;
  const gap = (message.timestamp ?? 0) - (previous.timestamp ?? 0);
  return gap >= 0 && gap < GROUP_WINDOW_MS;
}

/**
 * The scrolling message river, with the mock's day pills and unread rule.
 *
 * It sticks to the bottom while the reader is already there and leaves the
 * scroll position alone otherwise, so history loading never yanks the view.
 */
export function MessageList({
  messages,
  users,
  firstUnreadId,
  header,
  jumpTo,
  display = DEFAULT_CHAT_DISPLAY,
  currentScope = NO_SCOPE,
  renderMessage,
}: Readonly<MessageListProps>) {
  const { t } = useTranslation("nebulaCommon");
  // Compact mode is the reader asking for more conversation per screen, so the
  // air between messages goes the way the avatars do - and the compact message
  // style is the same request made from the other setting.
  const rowGap = display.compact || display.bubbleStyle === "compact" ? "9px" : "19px";
  /**
   * The air inside a block, as against `rowGap` between blocks.
   *
   * Spacing is the only thing left saying that six bubbles are one person
   * talking once the repeated name and clock have gone: at the full gap a run
   * of short messages reads as six separate arrivals, spread down the screen
   * with nothing tying them together. Closed up, the run is one shape and the
   * gap above it is what marks where the next speaker starts.
   */
  const groupGap = display.compact || display.bubbleStyle === "compact" ? "2px" : "4px";
  const scrollRef = useRef<HTMLDivElement>(null);
  /** The column the rows are mounted in - the observer's subtree. */
  const columnRef = useRef<HTMLDivElement>(null);

  // Publish what the scrollbar costs, once. It is a property of the platform
  // rather than of the conversation, so nothing here re-measures it; a browser
  // that reserves nothing simply publishes zero.
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    document.documentElement.style.setProperty(GUTTER_VAR, `${node.offsetWidth - node.clientWidth}px`);
  }, []);
  const pinnedToBottom = useRef(true);
  /** Pending "the reader has come to rest at the bottom" shrink. */
  const settleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(settleTimer.current), []);

  /**
   * How many of the newest messages are actually mounted.
   *
   * A busy channel holds hundreds of messages in memory and every one of them
   * was a live DOM subtree with an avatar, a sanitiser and a reaction
   * subscription behind it. The window is anchored to the end because that is
   * where reading starts; it grows as the reader climbs towards the top, and
   * snaps back once they are at the bottom again and the history above is no
   * longer being looked at.
   *
   * The sizing policy is core's, shared with Standard, so the two packs agree
   * about what "near the top" and "a chunk" mean.
   */
  const [tailCount, setTailCount] = useState(BASE_WINDOW);
  const previousCount = useRef(messages.length);
  /** Nonce of the last jump actually served, so widening can take two passes. */
  const servedJump = useRef(0);
  /** Scroll height before the last render, for the prepend correction below. */
  const previousHeight = useRef(0);
  const previousFirstId = useRef<string | null>(null);

  const windowed = useMemo(
    () => (messages.length <= tailCount ? messages : messages.slice(messages.length - tailCount)),
    [messages, tailCount],
  );
  // What the window leaves out - the offloader puts its heavy bodies away
  // without waiting for a row that is not going to be mounted.
  const unmounted = useMemo(
    () => (messages.length <= tailCount ? EMPTY_MESSAGES : messages.slice(0, messages.length - tailCount)),
    [messages, tailCount],
  );

  /**
   * Cold storage for the heavy bodies in this river.
   *
   * The window above unmounts the *row*; this releases the *content*, which is
   * the part that costs megabytes - a channel where people paste screenshots
   * holds the lot in memory otherwise, whether or not any of it is on screen.
   * The rows below carry the two attributes it watches for, and the messages
   * the window leaves out are handed over directly.
   */
  const { restoringKeys } = useMessageOffload({
    containerRef: scrollRef,
    innerRef: columnRef,
    currentScope,
    unmounted,
    // Nebula's rows already carry their id for the jump-to logic; there is no
    // sense in labelling them twice with two names that must agree.
    idAttribute: "data-message-id",
  });

  // Arrivals grow the window while the reader is scrolled up, so the rows
  // above the viewport keep their place instead of being unmounted from under
  // them; at the bottom it snaps back and the history is released.
  useLayoutEffect(() => {
    const appended = messages.length - previousCount.current;
    previousCount.current = messages.length;
    if (appended > 0) {
      setTailCount((prev) => tailCountAfterAppend(prev, appended, pinnedToBottom.current));
    }
  }, [messages.length]);

  // One batched avatar fetch for the whole list; the texture size comes from
  // the live user entry, which is the only place that knows it.
  const senders = useMemo(() => {
    const textures = new Map(users.map((user) => [user.session, user.texture_size]));
    const seen = new Set<number>();
    return windowed.flatMap((message) => {
      const session = message.sender_session;
      if (session == null || seen.has(session)) return [];
      seen.add(session);
      return [{ session, texture_size: textures.get(session) ?? null }];
    });
  }, [users, windowed]);
  const avatars = useUserAvatars(senders);
  const sections = useMemo(() => groupMessagesByDay(t, windowed), [t, windowed]);

  // Reading position is held across three different kinds of change, and they
  // want opposite things: an arriving message should follow the reader down if
  // they are at the bottom, while a page of history landing *above* them must
  // not move the text they are in the middle of reading. Telling them apart is
  // what the first id is for - it only changes when something was prepended.
  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node) return;

    const firstId = windowed[0]?.message_id ?? null;
    const prepended = previousFirstId.current !== null && firstId !== previousFirstId.current;
    previousFirstId.current = firstId;

    if (pinnedToBottom.current) node.scrollTop = node.scrollHeight;
    else if (prepended) node.scrollTop += node.scrollHeight - previousHeight.current;

    previousHeight.current = node.scrollHeight;
  }, [windowed]);

  // Jumping is deliberately not a scroll-into-view on every render: the row
  // is found by id at the moment it is asked for, and a message that is not
  // mounted (an older one still unfetched) simply does not move the view
  // rather than scrolling to the nearest wrong place.
  useLayoutEffect(() => {
    if (!jumpTo || servedJump.current === jumpTo.nonce) return;
    const index = messages.findIndex((message) => message.message_id === jumpTo.messageId);
    if (index !== -1) {
      setTailCount((prev) => tailCountToInclude(prev, index, messages.length));
    }
    // Scanned rather than matched with a selector: a message id is an opaque
    // string from the server, and building a selector out of one means
    // escaping it correctly for every id a server might mint.
    const rows = scrollRef.current?.querySelectorAll("[data-message-id]") ?? [];
    const node = [...rows].find((row) => (row as HTMLElement).dataset.messageId === jumpTo.messageId);
    // Not mounted yet: the widen above will re-run this once it lands, and the
    // nonce stays unserved so the second pass does the scrolling.
    if (!node) return;
    servedJump.current = jumpTo.nonce;
    pinnedToBottom.current = false;
    node.scrollIntoView({ block: "center", behavior: "smooth" });
    node.animate?.(
      [{ background: "transparent" }, { background: "rgba(120,150,255,.18)" }, { background: "transparent" }],
      { duration: 1200 },
    );
  }, [jumpTo, messages, tailCount]);

  return (
    <Box
      ref={scrollRef}
      onScroll={(event) => {
        const node = event.currentTarget;
        pinnedToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 60;
        if (node.scrollTop < GROW_THRESHOLD_PX) {
          setTailCount((prev) => grownTailCount(prev, messages.length));
        }
        // Growing is one-way otherwise: a reader who climbed through a busy
        // channel and came back down keeps every row they passed. Settling at
        // the bottom releases them, and the rows released are all above the
        // viewport, so nothing the reader is looking at moves.
        clearTimeout(settleTimer.current);
        if (pinnedToBottom.current) {
          settleTimer.current = setTimeout(() => {
            if (pinnedToBottom.current) setTailCount(settledTailCount);
          }, SETTLE_SHRINK_MS);
        }
      }}
      sx={{
        flex: 1,
        overflowY: "auto",
        // Reserved whether or not there is anything to scroll, so the column
        // does not step sideways as a conversation grows past one screen.
        scrollbarGutter: "stable",
        minHeight: 0,
        pt: "26px",
        pb: "12px",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Box
        ref={columnRef}
        sx={{
          width: "100%",
          maxWidth: CHAT_COLUMN_MAX_WIDTH,
          mx: "auto",
          boxSizing: "border-box",
          px: `${CHAT_COLUMN_INSET_PX}px`,
          display: "flex",
          flexDirection: "column",
          gap: rowGap,
          fontSize: `${display.fontSizePx}px`,
        }}
      >
        {header}
        {/* The rows space themselves, so the section itself sets no gap: only
            the row knows whether it continues the block above it or starts a
            new one, and one gap for the whole column cannot say both. */}
        {sections.map((section) => (
          <Stack key={section.key} gap={0}>
            <Box sx={{ display: "flex", justifyContent: "center" }}>
              <Typography
                sx={(theme) => ({
                  px: "11px",
                  py: "3px",
                  borderRadius: radius("lg"),
                  background: theme.palette.nebula.card,
                  border: `1px solid ${theme.palette.nebula.line}`,
                  fontSize: 10.5,
                  color: theme.palette.nebula.muted,
                })}
              >
                {section.label}
              </Typography>
            </Box>
            {section.messages.map((message, index) => {
              const grouped = isGrouped(message, section.messages[index - 1]);
              const next = section.messages[index + 1];
              const endsGroup = !next || !isGrouped(next, message);
              // The rule is a section break of its own: a message that happens
              // to continue the block above still needs room for it.
              const unread = !!firstUnreadId && message.message_id === firstUnreadId;
              return (
                <Stack
                  key={message.message_id ?? `${message.timestamp}-${index}`}
                  data-message-id={message.message_id ?? undefined}
                  // What the observer offloads. A body with no id cannot be
                  // asked for again, so it is never handed away.
                  data-msg-heavy={message.message_id && isHeavyContent(message.body) ? "" : undefined}
                  gap={rowGap}
                  sx={{ mt: grouped && !unread ? groupGap : rowGap }}
                >
                  {unread && <UnreadRule />}
                  {renderMessage(
                    message,
                    message.sender_session == null ? null : (avatars.get(message.sender_session) ?? null),
                    grouped,
                    message.message_id ? restoringKeys.has(message.message_id) : false,
                    endsGroup,
                  )}
                </Stack>
              );
            })}
          </Stack>
        ))}
      </Box>
    </Box>
  );
}

function UnreadRule() {
  return (
    <Stack direction="row" alignItems="center" gap={1.5}>
      <Divider sx={(theme) => ({ flex: 1, borderColor: theme.palette.nebula.line })} />
      <Typography
        sx={(theme) => ({
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.08em",
          color: theme.palette.nebula.bad,
        })}
      >
        NEW
      </Typography>
      <Divider sx={(theme) => ({ flex: 1, borderColor: theme.palette.nebula.line })} />
    </Stack>
  );
}
