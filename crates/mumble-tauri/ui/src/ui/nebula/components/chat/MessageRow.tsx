import { useEffect, useMemo, useRef, useState } from "react";
import { Box, IconButton, InputBase, Tooltip, Typography } from "@mui/material";
import DOMPurify from "dompurify";
import { useAppStore } from "@core/store";
import type { ChatMessage } from "@core/types";
import { getReactions, hasReacted } from "@core/features/chat/reaction/reactionStore";
import { decodeFileAttachmentPayload } from "@core/features/chat/fileAttachments";
import { getPoll } from "@core/features/chat/poll/model";
import {
  CheckIcon,
  CopyIcon,
  EditIcon,
  PinIcon,
  QuoteIcon,
  TrashIcon,
  WarningIcon,
} from "@ui/icons";
import ReactionBar from "@standard/components/chat/reaction/ReactionBar";
import EmojiPicker from "@standard/components/elements/EmojiPicker";
import LinkPreviewCard from "@standard/components/chat/linkpreview/LinkPreviewCard";
import WatchTogetherCard from "@standard/components/chat/watch/WatchTogetherCard";
import PollCard from "@standard/components/chat/poll/PollCard";
import FileAttachmentCard from "@standard/components/chat/file/FileAttachmentCard";
import ReadReceiptIndicator from "@standard/components/chat/readreceipt/ReadReceiptIndicator";
import QuoteBlock from "@standard/components/elements/QuoteBlock";
import { composerHtml, editableText, formatTime, messageContent } from "../../selectors";
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
  /** Cast a vote on a poll carried by this message. */
  onVote?: (pollId: string, selected: number[]) => void;
  /** Open the lightbox on an image inside the body. */
  onOpenImage?: (src: string) => void;
  /** Every id in the conversation, for the read-receipt watermark comparison. */
  allMessageIds?: readonly string[];
  /** Start a reply quoting this message. */
  onQuote?: (message: ChatMessage) => void;
  /** Bring the quoted message into view. */
  onJumpTo?: (messageId: string) => void;
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
  onVote,
  onOpenImage,
  allMessageIds,
  onQuote,
  onJumpTo,
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
  // Read polls through the store as well as the module map: the map is what
  // holds them, but only the store tells React that one has arrived.
  const knownPolls = useAppStore((state) => state.polls);

  const [editing, setEditing] = useState(false);

  // What the body *is* decides what gets drawn; only the leftover HTML is
  // sanitised, so a marker never reaches the renderer as text.
  const content = useMemo(() => messageContent(message.body), [message.body]);
  const body = useMemo(
    () => DOMPurify.sanitize(content.html, { USE_PROFILES: { html: true }, ADD_ATTR: ["target", "rel"] }),
    [content.html],
  );
  const poll =
    content.kind === "poll" ? (knownPolls.get(content.pollId) ?? getPoll(content.pollId)) : undefined;
  const attachment = content.kind === "file" ? decodeFileAttachmentPayload(content.payload) : null;
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

  // Only plain messages are editable: a poll or a file card has no text the
  // author typed, and rewriting the body would strip the marker the card is
  // drawn from.
  const canEdit = message.is_own && !!message.message_id && content.kind === "text";

  const commitEdit = (text: string) => {
    setEditing(false);
    const trimmed = text.trim();
    if (!trimmed || !message.message_id) return;
    if (trimmed === editableText(message.body).trim()) return;
    void useAppStore.getState().editMessage(message.channel_id, message.message_id, composerHtml(trimmed));
  };

  // An image in a body is a thumbnail of something larger; clicking it used to
  // do nothing at all. The handler sits on the container because the body is
  // set as HTML and has no elements of ours to bind to.
  const openImageUnder = (event: React.MouseEvent) => {
    const target = event.target as HTMLElement;
    if (target.tagName !== "IMG") return;
    const src = (target as HTMLImageElement).currentSrc || (target as HTMLImageElement).src;
    if (src) onOpenImage?.(src);
  };

  const hasBody = body.trim().length > 0;

  const quotes = content.quoteIds.map((id) => (
    <QuoteBlock key={id} messageId={id} onScrollTo={onJumpTo} />
  ));

  const extras = (
    <>
      {poll && (
        <PollCard
          poll={poll}
          ownSession={ownSession}
          isOwn={message.is_own}
          onVote={(pollId, selected) => onVote?.(pollId, selected)}
        />
      )}
      {attachment && <FileAttachmentCard info={attachment} />}
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
        {quotes}
        {editing ? (
          <BodyEditor
            initial={editableText(message.body)}
            onCommit={commitEdit}
            onCancel={() => setEditing(false)}
          />
        ) : (
          hasBody && (
            <Box
              onClick={openImageUnder}
              sx={(theme) => ({
                maxWidth: "min(620px, 78%)",
                px: "14px",
                py: "9px",
                borderRadius: `${radius("lg")} ${radius("lg")} ${radius("sm")} ${radius("lg")}`,
                background: theme.palette.nebula.accentSoft,
                border: `1px solid ${theme.palette.nebula.accentLine}`,
                lineHeight: 1.55,
                wordBreak: "break-word",
                "& img": {
                  maxWidth: "100%",
                  borderRadius: radius("lg"),
                  display: "block",
                  cursor: "zoom-in",
                },
                "& a": { color: theme.palette.nebula.accent },
              })}
              dangerouslySetInnerHTML={{ __html: body }}
            />
          )
        )}
        <Box sx={{ maxWidth: "min(620px, 78%)", width: "100%", display: "flex", justifyContent: "flex-end" }}>
          {extras}
        </Box>
        <Stack direction="row" alignItems="center" gap={0.75}>
          {hovered && !editing && (
            <RowActions
              message={message}
              onEdit={canEdit ? () => setEditing(true) : undefined}
              onQuote={message.message_id ? () => onQuote?.(message) : undefined}
            />
          )}
          <Typography sx={(theme) => ({ fontSize: 10.5, color: theme.palette.nebula.dim })}>
            {formatTime(message.timestamp)}
            {message.edited_at ? " · edited" : ""}
            {message.send_failed ? " · failed" : ""}
          </Typography>
          {/* The tick used to be printed as text and meant nothing; it now says
              whether anyone has actually read this far. */}
          {!message.send_failed && message.message_id && !message.dm_session && (
            <ReadReceiptIndicator
              messageId={message.message_id}
              channelId={message.channel_id}
              allMessageIds={allMessageIds ? [...allMessageIds] : []}
            />
          )}
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
              {message.edited_at ? " · edited" : ""}
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
            {hovered && !editing && (
              <RowActions
                message={message}
                onQuote={message.message_id ? () => onQuote?.(message) : undefined}
              />
            )}
          </Stack>
        )}
        {quotes}
        {hasBody && (
          <Box
            onClick={openImageUnder}
            sx={(theme) => ({
              mt: grouped ? 0 : "2px",
              lineHeight: 1.55,
              wordBreak: "break-word",
              "& img": {
                maxWidth: 320,
                borderRadius: radius("lg"),
                display: "block",
                mt: "8px",
                cursor: "zoom-in",
              },
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
        )}
        {extras}
      </Box>
    </Stack>
  );
}

/**
 * The bubble turned into a text box, in place.
 *
 * Editing happens on the row rather than in the composer: the composer may be
 * holding an unsent draft, and pulling a message into it would either discard
 * that draft or leave the author unsure which of the two Enter will send.
 */
function BodyEditor({
  initial,
  onCommit,
  onCancel,
}: Readonly<{ initial: string; onCommit: (text: string) => void; onCancel: () => void }>) {
  const [draft, setDraft] = useState(initial);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const node = inputRef.current;
    if (!node) return;
    node.focus();
    node.setSelectionRange(node.value.length, node.value.length);
  }, []);

  return (
    <Stack alignItems="flex-end" gap={0.5} sx={{ maxWidth: "min(620px, 78%)", width: "100%" }}>
      <InputBase
        inputRef={inputRef}
        multiline
        maxRows={8}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            onCommit(draft);
          }
        }}
        inputProps={{ "aria-label": "Edit message" }}
        sx={(theme) => ({
          width: "100%",
          px: "14px",
          py: "9px",
          fontSize: 13,
          lineHeight: 1.55,
          borderRadius: radius("lg"),
          background: theme.palette.nebula.accentSoft,
          border: `1px solid ${theme.palette.nebula.accent}`,
        })}
      />
      <Typography sx={(theme) => ({ fontSize: 10, color: theme.palette.nebula.dim })}>
        Enter saves · Esc cancels
      </Typography>
    </Stack>
  );
}

/** Hover affordances the mock keeps out of the resting state. */
function RowActions({
  message,
  onEdit,
  onQuote,
}: Readonly<{ message: ChatMessage; onEdit?: () => void; onQuote?: () => void }>) {
  const canModerate = message.is_own && !!message.message_id;
  return (
    <Stack direction="row" gap={0.25}>
      {onQuote && (
        <Tooltip title="Reply">
          <IconButton size="small" aria-label="Reply to message" onClick={onQuote}>
            <QuoteIcon width={12} height={12} />
          </IconButton>
        </Tooltip>
      )}
      {onEdit && (
        <Tooltip title="Edit">
          <IconButton size="small" aria-label="Edit message" onClick={onEdit}>
            <EditIcon width={12} height={12} />
          </IconButton>
        </Tooltip>
      )}
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
