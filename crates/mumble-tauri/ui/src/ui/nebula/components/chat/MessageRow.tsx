import { useEffect, useMemo, useRef, useState } from "react";
import { Box, InputBase, Tooltip, Typography } from "@mui/material";
import DOMPurify from "dompurify";
import { useAppStore } from "@core/store";
import type { ChatMessage } from "@core/types";
import { getReactions, hasReacted } from "@core/features/chat/reaction/reactionStore";
import { decodeFileAttachmentPayload } from "@core/features/chat/fileAttachments";
import { useLinkPreviews } from "@core/features/chat/useLinkPreviews";
import { getPoll } from "@core/features/chat/poll/model";
import {
  CheckIcon,
  CopyIcon,
  EditIcon,
  EmojiPlusIcon,
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
import { AttachmentVisibilityBadge } from "./AttachmentVisibilityBadge";
import ReadReceiptIndicator from "@standard/components/chat/readreceipt/ReadReceiptIndicator";
import QuoteBlock from "@standard/components/elements/QuoteBlock";
import { composerHtml, editableText, formatTime, messageContent, plainText } from "../../selectors";
import { LinkGuard, UserAvatar, Stack } from "../primitives";
import { floatingSurface } from "../../theme";
import { radius } from "../../tokens";

const WATCH_MARKER = /<!--\s*FANCY_WATCH:([^\s]+)\s*-->/;

/** The schemes a link in a message may point at; standard's renderer allows
 *  exactly these, and anything else loses its `href` rather than its text. */
const SAFE_URL_RE = /^(?:https?:|mailto:|#)/i;

/**
 * Sanitise a message body and hand its links to `LinkGuard`.
 *
 * DOMPurify keeps anchors but leaves them live, and a live anchor in a webview
 * navigates the app itself: the window becomes the target page with no way
 * back. Tagging each one `data-external` is what standard's renderer does, and
 * what the guard watches for before it hands the URL to the system browser.
 */
function sanitizeBody(html: string): string {
  const fragment = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["target", "rel"],
    RETURN_DOM_FRAGMENT: true,
  }) as unknown as DocumentFragment;

  for (const anchor of Array.from(fragment.querySelectorAll("a"))) {
    if (!SAFE_URL_RE.test((anchor.getAttribute("href") ?? "").trim())) {
      anchor.removeAttribute("href");
    }
    anchor.setAttribute("target", "_blank");
    anchor.setAttribute("rel", "noopener noreferrer");
    anchor.dataset["external"] = "true";
  }

  const wrapper = document.createElement("div");
  wrapper.appendChild(fragment);
  return wrapper.innerHTML;
}

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
  /** Right-click anywhere on the message. */
  onContextMenu?: (message: ChatMessage, at: { x: number; y: number }, editable: boolean) => void;
  /** Selection mode: null when off, otherwise whether this row is picked. */
  selected?: boolean | null;
  onToggleSelected?: (messageId: string) => void;
  /**
   * Whether this row is the one being edited.
   *
   * Held by the shell rather than the row because the message menu, which is
   * mounted once for the whole conversation, is one of the things that starts
   * an edit - and it cannot reach a row's own state.
   */
  editing?: boolean;
  onEditingChange?: (editing: boolean) => void;
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
  onContextMenu,
  selected = null,
  onToggleSelected,
  editing = false,
  onEditingChange,
}: Readonly<MessageRowProps>) {
  // The avatar and the name are two handles on one person, so they carry the
  // same hover, the same click and the same menu.
  const authorHandlers =
    message.sender_session == null
      ? {}
      : {
          onMouseEnter: (event: React.MouseEvent) => onHoverProfile?.(message.sender_session!, event),
          onMouseLeave: onLeaveProfile,
          onContextMenu: (event: React.MouseEvent) => onContextMenuProfile?.(message.sender_session!, event),
        };

  const [hovered, setHovered] = useState(false);
  /** Anchor for the reaction picker, or null while it is closed. */
  const [picker, setPicker] = useState<{ x: number; y: number } | null>(null);
  const ownSession = useAppStore((state) => state.ownSession);
  const users = useAppStore((state) => state.users);
  const embeds = useLinkPreviews(message.message_id, message.body);
  const allowExternal = useAppStore((state) => state.enableExternalEmbeds);
  const reactionVersion = useAppStore((state) => state.reactionVersion);
  // Read polls through the store as well as the module map: the map is what
  // holds them, but only the store tells React that one has arrived.
  const knownPolls = useAppStore((state) => state.polls);

  // What the body *is* decides what gets drawn; only the leftover HTML is
  // sanitised, so a marker never reaches the renderer as text.
  const content = useMemo(() => messageContent(message.body), [message.body]);
  const body = useMemo(() => sanitizeBody(content.html), [content.html]);
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
    onEditingChange?.(false);
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

  const openReactionPicker = (event: React.MouseEvent) => setPicker({ x: event.clientX, y: event.clientY });

  const selecting = selected !== null;
  const rowHandlers = {
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
    onContextMenu: (event: React.MouseEvent) => {
      if (!onContextMenu) return;
      event.preventDefault();
      onContextMenu(message, { x: event.clientX, y: event.clientY }, content.kind === "text");
    },
    // In selection mode the whole row is the checkbox: aiming at a small box
    // beside a wall of text is the slowest way to pick several things.
    onClick: selecting && message.message_id ? () => onToggleSelected?.(message.message_id!) : undefined,
    sx: selecting
      ? {
          cursor: "pointer",
          borderRadius: radius("md"),
          outline: selected ? "2px solid" : "none",
          outlineColor: "nebula.accent",
        }
      : undefined,
  };

  const quotes = content.quoteIds.map((id) => <QuoteBlock key={id} messageId={id} onScrollTo={onJumpTo} />);

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
      {attachment && (
        <FileAttachmentCard
          info={attachment}
          visibilityBadge={(overlaid) => <AttachmentVisibilityBadge info={attachment} overlay={overlaid} />}
        />
      )}
      {watchSessionId && <WatchTogetherCard sessionId={watchSessionId} mountKey={message.message_id ?? ""} />}
      {embeds && embeds.length > 0 && (
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
        {...rowHandlers}
        sx={{ position: "relative", ...(rowHandlers.sx ?? {}) }}
      >
        {hovered && !editing && (
          <RowActions
            message={message}
            align="right"
            onEdit={canEdit ? () => onEditingChange?.(true) : undefined}
            onQuote={message.message_id ? () => onQuote?.(message) : undefined}
            onReact={message.message_id ? openReactionPicker : undefined}
          />
        )}
        {quotes}
        {editing ? (
          <BodyEditor
            initial={editableText(message.body)}
            onCommit={commitEdit}
            onCancel={() => onEditingChange?.(false)}
          />
        ) : (
          hasBody && (
            <LinkGuard>
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
                  // A list keeps the river's rhythm: indented enough to read
                  // as one, not so far that it starts a column of its own.
                  "& ul, & ol": { my: "4px", pl: "22px" },
                  "& li": { my: "2px" },
                })}
                dangerouslySetInnerHTML={{ __html: body }}
              />
            </LinkGuard>
          )
        )}
        <Box sx={{ maxWidth: "min(620px, 78%)", width: "100%", display: "flex", justifyContent: "flex-end" }}>
          {extras}
        </Box>
        <Stack direction="row" alignItems="center" gap={0.75}>
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
      {...rowHandlers}
      sx={{ position: "relative", minWidth: 0, ...(rowHandlers.sx ?? {}) }}
    >
      {hovered && !editing && (
        <RowActions
          message={message}
          align="right"
          onQuote={message.message_id ? () => onQuote?.(message) : undefined}
          onReact={message.message_id ? openReactionPicker : undefined}
        />
      )}
      <Box sx={{ width: 38, flex: "none" }}>
        {!grouped && (
          <Box
            component="button"
            onClick={(event) =>
              message.sender_session != null && onOpenProfile(message.sender_session, event)
            }
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
              onClick={(event) =>
                message.sender_session != null && onOpenProfile(message.sender_session, event)
              }
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
          </Stack>
        )}
        {quotes}
        {hasBody && (
          <LinkGuard>
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
                // A list keeps the river's rhythm: indented enough to read
                // as one, not so far that it starts a column of its own.
                "& ul, & ol": { my: "4px", pl: "22px" },
                "& li": { my: "2px" },
              })}
              dangerouslySetInnerHTML={{ __html: body }}
            />
          </LinkGuard>
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

/** How far the hover pill stands off the message it belongs to. */
const PILL_GAP = 4;

/**
 * The hover menu: one pill standing just off the bubble's top edge.
 *
 * Not a strip inside the header row - the canvas floats it clear of the
 * message, so it neither reflows the text underneath nor lands on top of it,
 * and gives it the composer's rhythm at 80% scale: bare icons, and one divider
 * only before the destructive end.
 */
function RowActions({
  message,
  onEdit,
  onQuote,
  onReact,
  align,
}: Readonly<{
  message: ChatMessage;
  onEdit?: () => void;
  onQuote?: () => void;
  onReact?: (event: React.MouseEvent) => void;
  /** Which edge of the bubble the pill hangs from. */
  align: "left" | "right";
}>) {
  const canModerate = message.is_own && !!message.message_id;
  return (
    <Stack
      direction="row"
      alignItems="center"
      gap="14px"
      sx={(theme) => ({
        position: "absolute",
        // Above the row, not half over it: hanging into the message put the pill
        // on top of the first line, where it swallowed clicks meant for a link.
        bottom: `calc(100% + ${PILL_GAP}px)`,
        ...(align === "right" ? { right: 0 } : { left: 0 }),
        zIndex: 2,
        height: 34,
        px: "12px",
        borderRadius: radius("lg"),
        ...floatingSurface(theme),
        backdropFilter: "blur(30px)",
        WebkitBackdropFilter: "blur(30px)",
        color: theme.palette.nebula.muted,
        // The gap is air to look at, not to walk through: the pointer crossing
        // it has to stay inside the row, or the row stops being hovered and the
        // pill is gone before it is reached. This bridges it, invisibly.
        "&::after": {
          content: '""',
          position: "absolute",
          left: 0,
          right: 0,
          top: "100%",
          height: `${PILL_GAP}px`,
        },
      })}
    >
      {onReact && <PillButton label="Add reaction" onClick={onReact} icon={EmojiPlusIcon} />}
      {onQuote && <PillButton label="Reply to message" onClick={onQuote} icon={QuoteIcon} />}
      {onEdit && <PillButton label="Edit message" onClick={onEdit} icon={EditIcon} />}
      <PillButton
        label="Copy message"
        onClick={() => void navigator.clipboard?.writeText(plainText(message.body))}
        icon={CopyIcon}
      />
      {message.message_id && (
        <PillButton
          label={message.pinned ? "Unpin message" : "Pin message"}
          onClick={() =>
            void useAppStore.getState().pinMessage(message.channel_id, message.message_id!, !!message.pinned)
          }
          icon={message.pinned ? CheckIcon : PinIcon}
        />
      )}
      {canModerate && (
        <>
          {/* The only divider, and only ever before the destructive end. */}
          <Box
            aria-hidden
            sx={(theme) => ({ width: "1px", height: 14, background: theme.palette.nebula.line2 })}
          />
          <PillButton
            label="Delete message"
            onClick={() =>
              void useAppStore
                .getState()
                .deletePchatMessages(message.channel_id, { messageIds: [message.message_id!] })
            }
            icon={TrashIcon}
            danger
          />
        </>
      )}
    </Stack>
  );
}

/** One bare 15px icon in the hover pill. */
function PillButton({
  label,
  onClick,
  icon: Icon,
  danger = false,
}: Readonly<{
  label: string;
  onClick: (event: React.MouseEvent) => void;
  icon: React.ComponentType<{ width: number; height: number }>;
  danger?: boolean;
}>) {
  return (
    <Tooltip title={label}>
      <Box
        component="button"
        type="button"
        aria-label={label}
        onClick={onClick}
        sx={(theme) => ({
          all: "unset",
          cursor: "pointer",
          display: "grid",
          placeItems: "center",
          color: danger ? theme.palette.nebula.bad : "inherit",
          "&:hover": { color: danger ? theme.palette.nebula.bad : theme.palette.nebula.text },
        })}
      >
        <Icon width={15} height={15} />
      </Box>
    </Tooltip>
  );
}
