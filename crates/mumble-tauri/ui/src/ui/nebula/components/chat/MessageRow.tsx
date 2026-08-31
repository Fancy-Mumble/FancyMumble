import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, InputBase, Tooltip, Typography } from "@mui/material";
import type { Theme } from "@mui/material/styles";
import DOMPurify from "dompurify";
import { useAppStore } from "@core/store";
import type { ChatMessage } from "@core/types";
import { getReactions, hasReacted } from "@core/features/chat/reaction/reactionStore";
import { decodeFileAttachmentPayload } from "@core/features/chat/fileAttachments";
import { useLinkPreviews } from "@core/features/chat/useLinkPreviews";
import { getPoll } from "@core/features/chat/poll/model";
import { useWatchStart } from "@core/features/chat/watch/useWatchStart";
import { MENTION_CHIP_SELECTOR, readMentionChip } from "@core/utils/mentions";
import {
  CheckIcon,
  CopyIcon,
  EditIcon,
  EmojiPlusIcon,
  PinIcon,
  PlayIcon,
  QuoteIcon,
  TrashIcon,
  WarningIcon,
} from "@ui/icons";
import ReactionBar from "@standard/components/chat/reaction/ReactionBar";
import EmojiPicker from "@standard/components/elements/EmojiPicker";
import LinkPreviewCard from "./LinkPreviewCard";
import { WatchMarker } from "./watch/WatchMarker";
import PollCard from "@standard/components/chat/poll/PollCard";
import FileAttachmentCard from "@standard/components/chat/file/FileAttachmentCard";
import { AttachmentVisibilityBadge } from "./AttachmentVisibilityBadge";
import ReadReceiptIndicator from "@standard/components/chat/readreceipt/ReadReceiptIndicator";
import QuoteBlock from "@standard/components/elements/QuoteBlock";
import {
  composerHtml,
  DEFAULT_TIME_DISPLAY,
  editableText,
  formatTime,
  messageContent,
  plainText,
  type TimeDisplay,
} from "../../selectors";
import { MentionPopover, type MentionTarget } from "./MentionPopover";
import { LinkGuard, UserAvatar, Stack } from "../primitives";
import { floatingSurface } from "../../theme";
import { radius } from "../../tokens";
import type { HoverEvent } from "../../clientState";

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

/**
 * The mention chip, in the window's own colours.
 *
 * `applyMentionsToHtml` gives every mention a class and nothing else, so a
 * body that was not styled for them printed "@lorelando" as ordinary prose -
 * which is also how it behaved. `@everyone` and `@here` take the warning
 * colour they take everywhere: those are the two that reach a whole room.
 */
function mentionSx(theme: Theme) {
  const { nebula } = theme.palette;
  return {
    "& .mention": {
      display: "inline-block",
      px: "4px",
      mx: "1px",
      borderRadius: radius("sm"),
      fontWeight: 500,
      cursor: "pointer",
      color: nebula.accent,
      background: nebula.accentSoft,
    },
    "& .mention:hover": { background: nebula.accentLine },
    "& .mention-everyone, & .mention-here": {
      color: nebula.warn,
      background: `color-mix(in srgb, ${nebula.warn} 18%, transparent)`,
    },
    "& .mention-everyone:hover, & .mention-here:hover": {
      background: `color-mix(in srgb, ${nebula.warn} 32%, transparent)`,
    },
  } as const;
}

interface MessageRowProps {
  message: ChatMessage;
  avatar?: string | null;
  /** True when the previous message shares this sender and day. */
  grouped: boolean;
  onOpenProfile: (session: number, event: HoverEvent) => void;
  onHoverProfile?: (session: number, event: React.MouseEvent) => void;
  onLeaveProfile?: () => void;
  /** Right-click on the author - the same menu their row in any list opens. */
  onContextMenuProfile?: (session: number, event: React.MouseEvent) => void;
  /** Cast a vote on a poll carried by this message. */
  onVote?: (pollId: string, selected: number[]) => void;
  /** Open the lightbox on an image inside the body. */
  onOpenImage?: (src: string) => void;
  /**
   * The clock settings this row reads its timestamp under.
   *
   * A prop rather than a hook per row: the settings are one record read once
   * at the top of the client, and a busy channel mounts hundreds of these.
   */
  time?: TimeDisplay;
  /** Every id in the conversation, for the read-receipt watermark comparison. */
  allMessageIds?: readonly string[];
  /** Start a reply quoting this message. */
  onQuote?: (message: ChatMessage) => void;
  /** Bring the quoted message into view. */
  onJumpTo?: (messageId: string) => void;
  /** Right-click anywhere on the message. */
  onContextMenu?: (message: ChatMessage, at: { x: number; y: number }, editable: boolean) => void;
  /** Compact mode: no avatar column, and the row is tighter for it. */
  compact?: boolean;
  /**
   * Keep the action strip up on every message rather than on hover.
   *
   * Not the same strip left switched on: hovering hangs the pill *over* the row
   * above, which is right for the one row under the pointer and unreadable on
   * all of them at once. Pinned, it sits in the flow under its own message.
   */
  alwaysShowActions?: boolean;
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
  time = DEFAULT_TIME_DISPLAY,
  allMessageIds,
  onQuote,
  onJumpTo,
  onContextMenu,
  compact = false,
  alwaysShowActions = false,
  selected = null,
  onToggleSelected,
  editing = false,
  onEditingChange,
}: Readonly<MessageRowProps>) {
  const { t } = useTranslation(["nebulaChat", "chat"]);
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
  /** The mention chip whose member list is open, or null while none is. */
  const [mention, setMention] = useState<MentionTarget | null>(null);
  const ownSession = useAppStore((state) => state.ownSession);
  const users = useAppStore((state) => state.users);
  const embeds = useLinkPreviews(message.message_id, message.body);
  // The card carries its own "Watch together" where it has one, so the hover
  // strip stands down rather than offering the same thing twice on one row.
  const hasEmbeds = !!embeds && embeds.length > 0;
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

  /**
   * What a click inside the message body lands on.
   *
   * One handler on the container rather than listeners on the elements: the
   * body is set as HTML, so there is nothing of ours in there to bind to.
   *
   * A mention chip answers first, because it can sit inside anything. Naming
   * one person opens that person's card - the same card their row in any list
   * opens - and everything else is a list of people, which the panel draws.
   * An image is a thumbnail of something larger and opens the lightbox.
   */
  const onBodyClick = (event: React.MouseEvent) => {
    const target = event.target as HTMLElement;
    const chipElement = target.closest?.<HTMLElement>(MENTION_CHIP_SELECTOR) ?? null;
    const chip = chipElement && readMentionChip(chipElement);
    if (chip && chipElement) {
      event.preventDefault();
      if (chip.kind === "user" && users.some((user) => user.session === chip.session)) {
        // The card is placed beside the word that named them, not beside the
        // whole message - `currentTarget` here is the body, which is neither.
        onOpenProfile(chip.session, {
          clientX: event.clientX,
          clientY: event.clientY,
          currentTarget: chipElement,
        });
        return;
      }
      const rect = chipElement.getBoundingClientRect();
      setMention({ chip, at: { x: rect.left, y: rect.bottom + 6 } });
      return;
    }
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
      {watchSessionId && <WatchMarker sessionId={watchSessionId} />}
      {hasEmbeds && (
        <LinkPreviewCard
          embeds={embeds!}
          allowExternalResources={allowExternal}
          channelId={message.channel_id}
        />
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
      <MentionPopover target={mention} onClose={() => setMention(null)} />
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
        {hovered && !editing && !alwaysShowActions && (
          <RowActions
            watchOnCard={hasEmbeds}
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
                onClick={onBodyClick}
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
                  ...mentionSx(theme),
                })}
                dangerouslySetInnerHTML={{ __html: body }}
              />
            </LinkGuard>
          )
        )}
        <Box sx={{ maxWidth: "min(620px, 78%)", width: "100%", display: "flex", justifyContent: "flex-end" }}>
          {extras}
        </Box>
        {alwaysShowActions && !editing && (
          <RowActions
            watchOnCard={hasEmbeds}
            pinned
            message={message}
            align="right"
            onEdit={canEdit ? () => onEditingChange?.(true) : undefined}
            onQuote={message.message_id ? () => onQuote?.(message) : undefined}
            onReact={message.message_id ? openReactionPicker : undefined}
          />
        )}
        <Stack direction="row" alignItems="center" gap={0.75}>
          <Typography sx={(theme) => ({ fontSize: 10.5, color: theme.palette.nebula.dim })}>
            {formatTime(message.timestamp, time)}
            {message.edited_at ? t("nebulaChat:row.edited") : ""}
            {message.send_failed ? t("nebulaChat:row.failed") : ""}
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
      gap={compact ? 1 : 1.5}
      {...rowHandlers}
      sx={{ position: "relative", minWidth: 0, ...(rowHandlers.sx ?? {}) }}
    >
      {hovered && !editing && !alwaysShowActions && (
        <RowActions
          watchOnCard={hasEmbeds}
          message={message}
          align="right"
          onQuote={message.message_id ? () => onQuote?.(message) : undefined}
          onReact={message.message_id ? openReactionPicker : undefined}
        />
      )}
      {/* Compact mode drops the column rather than leaving a 38px gutter with
          nothing in it: the width is the avatar, not an indent. */}
      {!compact && (
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
              <UserAvatar
                name={message.sender_name}
                session={message.sender_session}
                src={avatar}
                size={38}
              />
            </Box>
          )}
        </Box>
      )}
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
              {formatTime(message.timestamp, time)}
              {message.edited_at ? t("nebulaChat:row.edited") : ""}
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
              onClick={onBodyClick}
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
                ...mentionSx(theme),
              })}
              dangerouslySetInnerHTML={{ __html: body }}
            />
          </LinkGuard>
        )}
        {extras}
        {alwaysShowActions && !editing && (
          <RowActions
            watchOnCard={hasEmbeds}
            pinned
            message={message}
            align="left"
            onQuote={message.message_id ? () => onQuote?.(message) : undefined}
            onReact={message.message_id ? openReactionPicker : undefined}
          />
        )}
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
  const { t } = useTranslation(["nebulaChat", "chat"]);
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
        inputProps={{ "aria-label": t("nebulaChat:row.editMessage") }}
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
        {t("nebulaChat:row.editHint")}
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
  pinned = false,
  watchOnCard = false,
}: Readonly<{
  message: ChatMessage;
  onEdit?: () => void;
  onQuote?: () => void;
  onReact?: (event: React.MouseEvent) => void;
  /** True where the link preview under the message already offers it. */
  watchOnCard?: boolean;
  /** Which edge of the bubble the pill hangs from. */
  align: "left" | "right";
  /**
   * Drawn in the flow under its own message instead of floating over the row
   * above - what "always show message actions" asks for. Floating is only safe
   * for the one row the pointer is on.
   */
  pinned?: boolean;
}>) {
  const { t } = useTranslation(["nebulaChat", "chat"]);
  const canModerate = message.is_own && !!message.message_id;
  /**
   * Starting a watch-together session, on the strip rather than only in the
   * right-click menu.
   *
   * The strip is the only affordance a message has - there is no kebab that
   * opens the menu - so an action that lives in the menu alone is an action
   * nobody finds. It appears on the two or three messages a day that carry a
   * video and on no others, which is what keeps the strip short.
   */
  const {
    canStart: canWatchTogether,
    busy: watchBusy,
    start: startWatch,
  } = useWatchStart(message.body, message.channel_id);
  return (
    <Stack
      direction="row"
      alignItems="center"
      gap="14px"
      sx={(theme) => ({
        ...(pinned
          ? { alignSelf: align === "right" ? "flex-end" : "flex-start", mt: "5px", height: 30 }
          : {
              position: "absolute",
              // Above the row, not half over it: hanging into the message put
              // the pill on top of the first line, where it swallowed clicks
              // meant for a link.
              bottom: `calc(100% + ${PILL_GAP}px)`,
              ...(align === "right" ? { right: 0 } : { left: 0 }),
              zIndex: 2,
              height: 34,
              backdropFilter: "blur(30px)",
              WebkitBackdropFilter: "blur(30px)",
              // The gap is air to look at, not to walk through: the pointer
              // crossing it has to stay inside the row, or the row stops being
              // hovered and the pill is gone before it is reached. This bridges
              // it, invisibly.
              "&::after": {
                content: '""',
                position: "absolute",
                left: 0,
                right: 0,
                top: "100%",
                height: `${PILL_GAP}px`,
              },
            }),
        width: "fit-content",
        px: "12px",
        borderRadius: radius("lg"),
        ...floatingSurface(theme),
        color: theme.palette.nebula.muted,
      })}
    >
      {onReact && <PillButton label={t("chat:reactions.add")} onClick={onReact} icon={EmojiPlusIcon} />}
      {onQuote && (
        <PillButton label={t("nebulaChat:row.replyToMessage")} onClick={onQuote} icon={QuoteIcon} />
      )}
      {onEdit && <PillButton label={t("nebulaChat:row.editMessage")} onClick={onEdit} icon={EditIcon} />}
      <PillButton
        label={t("chat:inlineActions.copy")}
        onClick={() => void navigator.clipboard?.writeText(plainText(message.body))}
        icon={CopyIcon}
      />
      {message.message_id && (
        <PillButton
          label={message.pinned ? t("chat:pinned.unpinAriaLabel") : t("nebulaChat:row.pinMessage")}
          onClick={() =>
            void useAppStore.getState().pinMessage(message.channel_id, message.message_id!, !!message.pinned)
          }
          icon={message.pinned ? CheckIcon : PinIcon}
        />
      )}
      {canWatchTogether && !watchOnCard && (
        <PillButton
          label={watchBusy ? t("chat:contextMenu.watchTogetherBusy") : t("chat:contextMenu.watchTogether")}
          onClick={() => void startWatch()}
          icon={PlayIcon}
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
            label={t("chat:contextMenu.deleteMessage")}
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
