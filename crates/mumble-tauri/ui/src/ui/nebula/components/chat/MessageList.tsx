import { useLayoutEffect, useMemo, useRef } from "react";
import { Stack } from "../primitives";
import { Box, Divider, Typography } from "@mui/material";
import { useUserAvatars } from "@core/lazyBlobs";
import type { ChatMessage, UserEntry } from "@core/types";
import { groupMessagesByDay } from "../../selectors";
import { radius } from "../../tokens";

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
  renderMessage: (message: ChatMessage, avatar: string | null, grouped: boolean) => React.ReactNode;
}

/** Consecutive messages from one sender collapse into a single block. */
const GROUP_WINDOW_MS = 5 * 60 * 1000;

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
  renderMessage,
}: Readonly<MessageListProps>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);
  /** Scroll height before the last render, for the prepend correction below. */
  const previousHeight = useRef(0);
  const previousFirstId = useRef<string | null>(null);

  // One batched avatar fetch for the whole list; the texture size comes from
  // the live user entry, which is the only place that knows it.
  const senders = useMemo(() => {
    const textures = new Map(users.map((user) => [user.session, user.texture_size]));
    const seen = new Set<number>();
    return messages.flatMap((message) => {
      const session = message.sender_session;
      if (session == null || seen.has(session)) return [];
      seen.add(session);
      return [{ session, texture_size: textures.get(session) ?? null }];
    });
  }, [messages, users]);
  const avatars = useUserAvatars(senders);
  const sections = useMemo(() => groupMessagesByDay(messages), [messages]);

  // Reading position is held across three different kinds of change, and they
  // want opposite things: an arriving message should follow the reader down if
  // they are at the bottom, while a page of history landing *above* them must
  // not move the text they are in the middle of reading. Telling them apart is
  // what the first id is for - it only changes when something was prepended.
  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node) return;

    const firstId = messages[0]?.message_id ?? null;
    const prepended = previousFirstId.current !== null && firstId !== previousFirstId.current;
    previousFirstId.current = firstId;

    if (pinnedToBottom.current) node.scrollTop = node.scrollHeight;
    else if (prepended) node.scrollTop += node.scrollHeight - previousHeight.current;

    previousHeight.current = node.scrollHeight;
  }, [messages]);

  // Jumping is deliberately not a scroll-into-view on every render: the row
  // is found by id at the moment it is asked for, and a message that is not
  // mounted (an older one still unfetched) simply does not move the view
  // rather than scrolling to the nearest wrong place.
  useLayoutEffect(() => {
    if (!jumpTo) return;
    // Scanned rather than matched with a selector: a message id is an opaque
    // string from the server, and building a selector out of one means
    // escaping it correctly for every id a server might mint.
    const rows = scrollRef.current?.querySelectorAll("[data-message-id]") ?? [];
    const node = [...rows].find((row) => (row as HTMLElement).dataset.messageId === jumpTo.messageId);
    if (!node) return;
    pinnedToBottom.current = false;
    node.scrollIntoView({ block: "center", behavior: "smooth" });
    node.animate?.(
      [{ background: "transparent" }, { background: "rgba(120,150,255,.18)" }, { background: "transparent" }],
      { duration: 1200 },
    );
  }, [jumpTo]);

  return (
    <Box
      ref={scrollRef}
      onScroll={(event) => {
        const node = event.currentTarget;
        pinnedToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 60;
      }}
      sx={{
        flex: 1,
        overflowY: "auto",
        minHeight: 0,
        px: "34px",
        pt: "26px",
        pb: "12px",
        display: "flex",
        flexDirection: "column",
        gap: "19px",
      }}
    >
      {header}
      {sections.map((section) => (
        <Stack key={section.key} gap="19px">
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
          {section.messages.map((message, index) => (
            <Stack
              key={message.message_id ?? `${message.timestamp}-${index}`}
              data-message-id={message.message_id ?? undefined}
              gap="19px"
            >
              {firstUnreadId && message.message_id === firstUnreadId && <UnreadRule />}
              {renderMessage(
                message,
                message.sender_session == null ? null : (avatars.get(message.sender_session) ?? null),
                isGrouped(message, section.messages[index - 1]),
              )}
            </Stack>
          ))}
        </Stack>
      ))}
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
