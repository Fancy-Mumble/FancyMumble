import { useEffect, useMemo, useRef } from "react";
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
export function MessageList({ messages, users, firstUnreadId, renderMessage }: Readonly<MessageListProps>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);

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

  useEffect(() => {
    const node = scrollRef.current;
    if (node && pinnedToBottom.current) node.scrollTop = node.scrollHeight;
  }, [messages]);

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
            <Stack key={message.message_id ?? `${message.timestamp}-${index}`} gap="19px">
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
