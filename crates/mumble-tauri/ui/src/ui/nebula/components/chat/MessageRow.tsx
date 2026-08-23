import { useMemo, useState } from "react";
import { Box, IconButton, Tooltip, Typography } from "@mui/material";
import DOMPurify from "dompurify";
import { useAppStore } from "@core/store";
import type { ChatMessage } from "@core/types";
import { getReactions, hasReacted } from "@core/features/chat/reaction/reactionStore";
import { CheckIcon, CopyIcon, PinIcon, TrashIcon, WarningIcon } from "@ui/icons";
import ReactionBar from "@standard/components/chat/reaction/ReactionBar";
import EmojiPicker from "@standard/components/elements/EmojiPicker";
import LinkPreviewCard from "@standard/components/chat/linkpreview/LinkPreviewCard";
import WatchTogetherCard from "@standard/components/chat/watch/WatchTogetherCard";
import { formatTime } from "../../selectors";
import { UserAvatar, Stack } from "../primitives";
import { radius } from "../../tokens";

const WATCH_MARKER = /<!--\s*FANCY_WATCH:([^\s]+)\s*-->/;

interface MessageRowProps {
  message: ChatMessage;
  avatar?: string | null;
  /** True when the previous message shares this sender and day. */
  grouped: boolean;
  onOpenProfile: (session: number, event: React.MouseEvent) => void;
  onHoverProfile?: (session: number, event: React.MouseEvent) => void;
  onLeaveProfile?: () => void;
  /** Right-click on the author - the same menu their row in any list opens. */
  onContextMenuProfile?: (session: number, event: React.MouseEvent) => void;
}

/**
 * One message.
 *
 * The mock draws two different objects: other people's messages are an avatar
 * plus a name/time header over flowing text, while your own are a right-aligned
 * accent bubble with the timestamp underneath. Everything below that split -
 * body sanitising, reactions, previews - is shared.
 */
export function MessageRow({
  message,
  avatar,
  grouped,
  onOpenProfile,
  onHoverProfile,
  onLeaveProfile,
  onContextMenuProfile,
}: Readonly<MessageRowProps>) {
  // The avatar and the name are two handles on one person, so they carry the
  // same hover, the same click and the same menu.
  const authorHandlers =
    message.sender_session == null
      ? {}
      : {
          onMouseEnter: (event: React.MouseEvent) => onHoverProfile?.(message.sender_session!, event),
          onMouseLeave: onLeaveProfile,
          onContextMenu: (event: React.MouseEvent) =>
            onContextMenuProfile?.(message.sender_session!, event),
        };

  const [hovered, setHovered] = useState(false);
  /** Anchor for the reaction picker, or null while it is closed. */
  const [picker, setPicker] = useState<{ x: number; y: number } | null>(null);
  const ownSession = useAppStore((state) => state.ownSession);
  const users = useAppStore((state) => state.users);
  const embeds = useAppStore((state) =>
    message.message_id ? state.linkEmbeds.get(message.message_id) : undefined,
  );
  const disablePreviews = useAppStore((state) => state.disableLinkPreviews);
  const allowExternal = useAppStore((state) => state.enableExternalEmbeds);
  const reactionVersion = useAppStore((state) => state.reactionVersion);

  const body = useMemo(
    () => DOMPurify.sanitize(message.body, { USE_PROFILES: { html: true }, ADD_ATTR: ["target", "rel"] }),
    [message.body],
  );
  // Reactions live in a side store keyed by message id; the version counter is
  // the only thing that tells React a toggle landed.
  const reactions = reactionVersion >= 0 && message.message_id ? getReactions(message.message_id) : [];
  const watchSessionId = WATCH_MARKER.exec(message.body)?.[1];
  const ownHash = users.find((user) => user.session === ownSession)?.hash ?? "";

  const toggleReaction = (emoji: string) => {
    if (!message.message_id || ownSession === null) return;
    void useAppStore
      .getState()
      .sendReaction(
        message.channel_id,
        message.message_id,
        emoji,
        ownHash && hasReacted(message.message_id, emoji, ownHash) ? "remove" : "add",
      );
  };

  const extras = (
    <>
      {watchSessionId && <WatchTogetherCard sessionId={watchSessionId} mountKey={message.message_id ?? ""} />}
      {embeds && !disablePreviews && (
        <LinkPreviewCard embeds={embeds} allowExternalResources={allowExternal} />
      )}
      {reactions.length > 0 && (
        <ReactionBar
          reactions={reactions}
          ownHash={ownHash}
          isOwn={message.is_own}
          onToggle={toggleReaction}
          onAdd={(event) => setPicker({ x: event.clientX, y: event.clientY })}
        />
      )}
      {picker && (
        <EmojiPicker
          anchorX={picker.x}
          anchorY={picker.y}
          onSelect={(emoji) => {
            toggleReaction(emoji);
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
        />
      )}
    </>
  );

  if (message.is_own) {
    return (
      <Stack
        alignItems="flex-end"
        gap={0.5}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <Box
          sx={(theme) => ({
            maxWidth: "min(620px, 78%)",
            px: "14px",
            py: "9px",
            borderRadius: `${radius("lg")} ${radius("lg")} ${radius("sm")} ${radius("lg")}`,
            background: theme.palette.nebula.accentSoft,
            border: `1px solid ${theme.palette.nebula.accentLine}`,
            lineHeight: 1.55,
            wordBreak: "break-word",
            "& img": { maxWidth: "100%", borderRadius: radius("lg"), display: "block" },
            "& a": { color: theme.palette.nebula.accent },
          })}
          dangerouslySetInnerHTML={{ __html: body }}
        />
        <Box sx={{ maxWidth: "min(620px, 78%)", width: "100%", display: "flex", justifyContent: "flex-end" }}>
          {extras}
        </Box>
        <Stack direction="row" alignItems="center" gap={0.75}>
          {hovered && <RowActions message={message} />}
          <Typography sx={(theme) => ({ fontSize: 10.5, color: theme.palette.nebula.dim })}>
            {formatTime(message.timestamp)}
            {message.send_failed ? " · failed" : " ✓"}
          </Typography>
          {message.send_failed && (
            <Box sx={(theme) => ({ display: "flex", color: theme.palette.nebula.bad })}>
              <WarningIcon width={11} height={11} />
            </Box>
          )}
        </Stack>
      </Stack>
    );
  }

  return (
    <Stack
      direction="row"
      gap={1.5}
      sx={{ minWidth: 0 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Box sx={{ width: 38, flex: "none" }}>
        {!grouped && (
          <Box
            component="button"
            onClick={(event) => message.sender_session != null && onOpenProfile(message.sender_session, event)}
            {...authorHandlers}
            sx={{ all: "unset", cursor: "pointer", display: "flex" }}
          >
            <UserAvatar name={message.sender_name} session={message.sender_session} src={avatar} size={38} />
          </Box>
        )}
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        {!grouped && (
          <Stack direction="row" alignItems="baseline" gap={1}>
            <Typography
              component="button"
              onClick={(event) => message.sender_session != null && onOpenProfile(message.sender_session, event)}
              {...authorHandlers}
              sx={{
                all: "unset",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: 13,
              }}
            >
              {message.sender_name}
            </Typography>
            <Typography sx={(theme) => ({ fontSize: 10.5, color: theme.palette.nebula.dim })}>
              {formatTime(message.timestamp)}
            </Typography>
            {message.plugin_name && (
              <Typography
                sx={(theme) => ({
                  fontSize: 9.5,
                  fontWeight: 600,
                  px: "6px",
                  borderRadius: radius("sm"),
                  background: theme.palette.nebula.card2,
                  color: theme.palette.nebula.muted,
                })}
              >
                {message.plugin_name}
              </Typography>
            )}
            {hovered && <RowActions message={message} />}
          </Stack>
        )}
        <Box
          sx={(theme) => ({
            mt: grouped ? 0 : "2px",
            lineHeight: 1.55,
            wordBreak: "break-word",
            "& img": { maxWidth: 320, borderRadius: radius("lg"), display: "block", mt: "8px" },
            "& a": { color: theme.palette.nebula.accent },
            "& code": {
              fontFamily: theme.typography.fontFamily,
              px: "6px",
              borderRadius: radius("sm"),
              background: theme.palette.nebula.card2,
              fontSize: 11.5,
            },
          })}
          dangerouslySetInnerHTML={{ __html: body }}
        />
        {extras}
      </Box>
    </Stack>
  );
}

/** Hover affordances the mock keeps out of the resting state. */
function RowActions({ message }: Readonly<{ message: ChatMessage }>) {
  const canModerate = message.is_own && !!message.message_id;
  return (
    <Stack direction="row" gap={0.25}>
      <Tooltip title="Copy text">
        <IconButton
          size="small"
          aria-label="Copy message"
          onClick={() => void navigator.clipboard?.writeText(message.body.replace(/<[^>]*>/g, ""))}
        >
          <CopyIcon width={12} height={12} />
        </IconButton>
      </Tooltip>
      {message.message_id && (
        <Tooltip title={message.pinned ? "Unpin" : "Pin"}>
          <IconButton
            size="small"
            aria-label={message.pinned ? "Unpin message" : "Pin message"}
            onClick={() =>
              void useAppStore
                .getState()
                .pinMessage(message.channel_id, message.message_id!, !!message.pinned)
            }
          >
            {message.pinned ? <CheckIcon width={12} height={12} /> : <PinIcon width={12} height={12} />}
          </IconButton>
        </Tooltip>
      )}
      {canModerate && (
        <Tooltip title="Delete">
          <IconButton
            size="small"
            aria-label="Delete message"
            onClick={() =>
              void useAppStore
                .getState()
                .deletePchatMessages(message.channel_id, { messageIds: [message.message_id!] })
            }
          >
            <TrashIcon width={12} height={12} />
          </IconButton>
        </Tooltip>
      )}
    </Stack>
  );
}
