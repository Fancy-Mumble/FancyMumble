import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, InputBase, Tooltip, Typography } from "@mui/material";
import type { Theme } from "@mui/material/styles";
import DOMPurify from "dompurify";
import { parseBody } from "./bodyCache";
import { useAppStore } from "@core/store";
import { selectOwnHash } from "@core/store/selectors";
import { LOCAL_NOTES_CHANNEL_ID } from "@core/notepad";
import { extractOffloadInfo } from "@core/messageOffload";
import type { ChatMessage } from "@core/types";
import type { BubbleStyle } from "@standard/personalizationStorage";
import { getReactions, hasReacted, reactionRevision } from "@core/features/chat/reaction/reactionStore";
import { decodeFileAttachmentPayload } from "@core/features/chat/fileAttachments";
import { useLinkPreviews } from "@core/features/chat/useLinkPreviews";
import { getPoll } from "@core/features/chat/poll/model";
import { useWatchStart } from "@core/features/chat/watch/useWatchStart";
import { neutraliseRemoteMedia } from "@core/utils/remoteMedia";
import { readWatchMarker } from "@core/features/chat/watch/watchMarker";
import { MENTION_CHIP_SELECTOR, readMentionChip } from "@core/utils/mentions";
import { useInnerHtml } from "@core/utils/innerHtml";
import { sanitiseInlineStyles } from "@core/utils/sanitizeHtml";
import { useSelfMention } from "@core/features/chat/selfMention";
import { linkUnder } from "@core/features/elements/externalLinks";
import { TID } from "@core/testids";
import {
  CheckIcon,
  CopyIcon,
  EditIcon,
  EmojiPlusIcon,
  KebabMenuIcon,
  PinIcon,
  PlayIcon,
  QuoteIcon,
  TrashIcon,
  WarningIcon,
} from "@ui/icons";
import ReactionBar from "./ReactionBar";
import EmojiPicker from "@standard/components/elements/EmojiPicker";
import LinkPreviewCard from "./LinkPreviewCard";
import { isOnlyLinks, prettyLinks } from "./prettyLinks";
import { WatchMarker } from "./watch/WatchMarker";
import PollCard from "./PollCard";
import ReadReceiptIndicator from "./ReadReceiptIndicator";
import QuoteBlock from "./QuoteBlock";
import {
  composerHtml,
  DEFAULT_TIME_DISPLAY,
  editableText,
  formatTime,
  hasDrawableHtml,
  type TimeDisplay,
} from "../../selectors";
import { AttachmentGallery, MediaGallery } from "./MediaGallery";
import { OffloadedBody } from "./OffloadedBody";
import { MentionPopover, type MentionTarget } from "./MentionPopover";
import { UserAvatar, Stack } from "../primitives";
import { textColorForBg } from "@shared/profilecard";
import { chamferedSurface, floatingSurface } from "../../theme";
import { NEBULA_MONO, radius } from "../../tokens";
import type { HoverEvent } from "../../clientState";
import { bodyToCopyText } from "@core/features/chat/bodyText";
import type { MenuImage } from "./MessageMenu";
import { useLongPress } from "./useLongPress";
import { useRowHover } from "./rowHover";
import { alpha } from "@mui/material/styles";

/** The schemes a link in a message may point at; standard's renderer allows
 *  exactly these, and anything else loses its `href` rather than its text. */
const SAFE_URL_RE = /^(?:https?:|mailto:|#)/i;

/**
 * The clock reading, wherever it is drawn.
 *
 * One constant because a timestamp is the same piece of furniture whether it
 * heads a block beside the author's name or hangs under a bubble, and two
 * sizes for it is a difference nobody chose. It is set well under the 13px
 * name and the reader's own body size: the time is there to be found, not
 * read, and at the previous 10.5px a column of them was the loudest thing on
 * a screen of short messages.
 */
const stampSx = (theme: Theme) =>
  ({
    fontSize: 9.5,
    lineHeight: 1.4,
    letterSpacing: "0.01em",
    color: theme.palette.nebula.dim,
    // `flex: none` keeps it off the name's shrink budget: a long display name
    // is what gets truncated, never the four digits beside it.
    flex: "none",
  }) as const;

/**
 * Sanitise a message body and mark its links for the conversation's guard.
 *
 * DOMPurify keeps anchors but leaves them live, and a live anchor in a webview
 * navigates the app itself: the window becomes the target page with no way
 * back. Tagging each one `data-external` is what standard's renderer does, and
 * what the guard watches for before it hands the URL to the system browser.
 */
/** The row's own reading of a body: sanitised, then its links shortened. */
function sanitizeAndPretty(html: string): string {
  return prettyLinks(sanitizeBody(html));
}

function sanitizeBody(html: string): string {
  const fragment = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["target", "rel"],
    RETURN_DOM_FRAGMENT: true,
  }) as unknown as DocumentFragment;
  // Clips, posters and inline-style images the splitter did not lift: none of
  // them may fetch on their own. Before the anchor pass, which marks the links
  // this leaves behind like every other one.
  neutraliseRemoteMedia(fragment);

  for (const anchor of Array.from(fragment.querySelectorAll("a"))) {
    if (!SAFE_URL_RE.test((anchor.getAttribute("href") ?? "").trim())) {
      anchor.removeAttribute("href");
    }
    anchor.setAttribute("target", "_blank");
    anchor.setAttribute("rel", "noopener noreferrer");
    anchor.dataset["external"] = "true";
  }
  // The same property allow-list every other surface renders untrusted HTML
  // with. DOMPurify alone kept `style` whole, so one message could carry
  // `position:fixed;inset:0;z-index:...` and cover - and swallow every tap on -
  // the whole window, on every client in the channel.
  sanitiseInlineStyles(fragment);

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

/**
 * How formatted markup sits inside a bubble.
 *
 * Bold, italic, underline and strikethrough need nothing here - they are tags
 * and the browser draws them. Code does: an unstyled `<code>` is a run of
 * ordinary prose, and an unstyled `<pre>` is a paragraph that has lost its
 * line breaks, which is most of what a code block is for. Both bubbles take
 * the same rules, because a code span that was a chip in a received message
 * and prose in your own reads as two different messages.
 */
function bodyMarkupSx(theme: Theme) {
  const { nebula } = theme.palette;
  return {
    "& code": {
      fontFamily: theme.typography.fontFamily,
      px: "6px",
      borderRadius: radius("sm"),
      background: nebula.card2,
      fontSize: 11.5,
    },
    // A block keeps its own indentation, so it takes a real monospace face and
    // scrolls rather than wrapping: a wrapped line of code is a wrong line.
    "& pre": {
      my: "6px",
      p: "8px 10px",
      borderRadius: radius("sm"),
      background: nebula.card2,
      border: `var(--nebula-line-width, 1px) solid ${nebula.line}`,
      overflowX: "auto",
    },
    "& pre code": {
      fontFamily: NEBULA_MONO,
      display: "block",
      px: 0,
      background: "none",
      whiteSpace: "pre",
    },
    // A list keeps the river's rhythm: indented enough to read as one, not so
    // far that it starts a column of its own.
    "& ul, & ol": { my: "4px", pl: "22px" },
    "& li": { my: "2px" },
  } as const;
}

/**
 * A bubble's plate, in its picked colours or its ordinary ones.
 *
 * Being picked used to be a ring in the accent drawn around the whole row,
 * which on the own side is an accent ring around an accent bubble - a halo
 * rather than a mark, and one that says nothing about which part of the row is
 * the message. The mark is the bubble's own colour instead: a neutral card is
 * pushed towards the accent, and a bubble that is already the accent has
 * nowhere left to push, so it steps away from the ink it carries - which is
 * the one direction that cannot cost the text its contrast, and is a deeper
 * accent under white ink, a lighter one under dark.
 */
function bubbleSurface(theme: Theme, fill: string, line: string, picked: boolean) {
  const { nebula } = theme.palette;
  const away = textColorForBg(nebula.onAccent);
  const pick = (colour: string) =>
    colour === nebula.accent
      ? `color-mix(in srgb, ${away} 26%, ${nebula.accent})`
      : `color-mix(in srgb, ${nebula.accent} 26%, ${colour})`;
  // Edge and fill move together: shifting only the fill leaves the old edge
  // colour around it, which is the ring this replaced.
  return picked ? chamferedSurface(theme, pick(fill), pick(line)) : chamferedSurface(theme, fill, line);
}

interface MessageRowProps {
  message: ChatMessage;
  avatar?: string | null;
  /** True when the previous message shares this sender and day. */
  grouped: boolean;
  /**
   * True when the next message starts a block of its own - this is the last
   * message of its group.
   *
   * The clock reading belongs to the block rather than to every message in it.
   * Seven bubbles sent inside one minute printed "22:25" seven times, which is
   * six lines of chrome that say nothing; it now hangs under the last of them,
   * which is both where the reader's eye already is and the time the block
   * actually ended at. The left-hand column makes the mirror-image choice for
   * the same reason - name and time head the block, once.
   */
  endsGroup?: boolean;
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
  /**
   * Right-click anywhere on the message.
   *
   * `selection` is whatever the reader had highlighted when they right-clicked,
   * where the highlight touches this row - read here rather than in the menu
   * because opening the menu is the moment it can be lost, and because a
   * highlight running across three messages is still one thing to copy.
   *
   * `image` is the picture under the pointer, when the right-click landed on
   * one, for the same reason: which of a block's four tiles was aimed at is a
   * fact about the event, and it is gone by the time the menu is open. `link`
   * is the same fact about an external link, and is read the same way.
   */
  onContextMenu?: (
    message: ChatMessage,
    at: { x: number; y: number },
    context: {
      editable: boolean;
      selection: string;
      image: MenuImage | null;
      link: string | null;
    },
  ) => void;
  /** Compact mode: no avatar column, and the row is tighter for it. */
  compact?: boolean;
  /**
   * The shape the message is drawn in, from the Personalize page.
   *
   * "bubbles" gives every message a rounded card - yours on the right in the
   * accent, everyone else's on the left in the surface colour. "flat" drops
   * the chrome and puts all of them in one left-aligned river, and "compact"
   * additionally drops the avatars and runs the name into the line.
   */
  bubbleStyle?: BubbleStyle;
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
  /**
   * Which message is being edited, by id, or null for none.
   *
   * Said as an id rather than as a boolean about this row, so the shell can
   * hand over its own setter instead of making a closure over this message on
   * every render - which is a fresh prop, which is a row that renders again.
   */
  onEditingChange?: (messageId: string | null) => void;
  /**
   * Its body is in cold storage and being read back right now.
   *
   * The offloaded state itself is in the body - a placeholder the backend
   * wrote there - so the row can see that for itself; only "on its way back"
   * lives outside it, in the list that asked for it.
   */
  restoring?: boolean;
  /**
   * The list is drawing the avatar itself, one per block, in a column that
   * follows the block down the screen - so the row reserves the gutter and
   * puts nothing in it.
   *
   * A picture that belongs to a run of messages cannot live inside the first
   * of them: it can only stick within its own box, and that box is one
   * message tall. Hoisting it to something that spans the whole run is what
   * lets it travel to the last message of the block and stop there.
   */
  stickyAvatar?: boolean;
}

/** The width of the avatar gutter, shared with the list that hoists it. */
export const AVATAR_COLUMN_PX = 38;

/** One empty list, shared: a new `[]` per render is a new prop per render. */
const EMPTY_IDS: readonly string[] = [];
const EMPTY_REACTIONS: ReturnType<typeof getReactions> = [];
const EMPTY_ATTACHMENTS: NonNullable<ReturnType<typeof decodeFileAttachmentPayload>>[] = [];
/**
 * The air between the avatar gutter and the body, and between the row's edge
 * and the body where there is no gutter.
 *
 * A number rather than a spacing unit because the hover pill has to land on
 * the body's left edge, and "1.5 spacing units" is not something an `absolute`
 * offset can be written in.
 */
const ROW_GAP_PX = { roomy: 12, dense: 8 } as const;

interface MessageAvatarProps {
  message: ChatMessage;
  avatar?: string | null;
  onOpenProfile: (session: number, event: HoverEvent) => void;
  onHoverProfile?: (session: number, event: React.MouseEvent) => void;
  onLeaveProfile?: () => void;
  onContextMenuProfile?: (session: number, event: React.MouseEvent) => void;
}

/**
 * The author's picture, as the handle on them that it is.
 *
 * Its own component because it is drawn from two places: inside the row, and -
 * when the list hoists it - in a column of the list's own that spans the whole
 * block. Both draw the same button, with the same click, hover and menu the
 * author's name carries.
 */
export function MessageAvatar({
  message,
  avatar,
  onOpenProfile,
  onHoverProfile,
  onLeaveProfile,
  onContextMenuProfile,
}: Readonly<MessageAvatarProps>) {
  const session = message.sender_session;
  return (
    <Box
      component="button"
      onClick={(event: React.MouseEvent) => session != null && onOpenProfile(session, event)}
      onMouseEnter={(event: React.MouseEvent) => session != null && onHoverProfile?.(session, event)}
      onMouseLeave={onLeaveProfile}
      onContextMenu={(event: React.MouseEvent) => session != null && onContextMenuProfile?.(session, event)}
      sx={{ all: "unset", cursor: "pointer", display: "flex" }}
    >
      <UserAvatar
        name={message.sender_name}
        session={message.sender_session}
        src={avatar}
        size={AVATAR_COLUMN_PX}
      />
    </Box>
  );
}

/**
 * One message.
 *
 * The mock draws two different objects: other people's messages are an avatar
 * plus a name/time header over flowing text, while your own are a right-aligned
 * accent bubble with the timestamp underneath. Everything below that split -
 * body sanitising, reactions, previews - is shared.
 *
 * Which of the two a message gets is the Personalize page's "Message style"
 * rather than the mock's fixed rule: the right-hand accent bubble is what
 * "bubbles" means for your own messages, and in that style everyone else's
 * body gets a card too, because the setting's own copy promises every message
 * in a rounded card. "flat" and "compact" send yours down the author-row path
 * with everybody else's, which is what "one continuous river" means.
 */
/**
 * One message.
 *
 * Memoised, and that is the single most valuable line in this file. The shell
 * above rebuilds every pane's props on each of its own renders, and a busy
 * channel keeps a hundred of these mounted, each parsing its body and
 * serialising a dozen style objects. Without the comparison here, anything at
 * all happening anywhere in the client - a menu opening, a card appearing, a
 * message arriving - re-rendered every one of them.
 *
 * The comparison is only worth having while the props are stable, which is why
 * the shell hands over `popupActions` and its own setters rather than closures
 * made this render, and why `onEditingChange` says *which* message rather than
 * "this one".
 */
export const MessageRow = memo(function MessageRow({
  message,
  avatar,
  grouped,
  endsGroup = true,
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
  bubbleStyle = "bubbles",
  alwaysShowActions = false,
  selected = null,
  onToggleSelected,
  editing = false,
  onEditingChange,
  restoring = false,
  stickyAvatar = false,
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

  const { hovered, ref: hoverRef, onMouseEnter: enterRow, onMouseLeave: leaveRow } = useRowHover();
  /** Anchor for the reaction picker, or null while it is closed. */
  const [picker, setPicker] = useState<{ x: number; y: number } | null>(null);
  /** The mention chip whose member list is open, or null while none is. */
  const [mention, setMention] = useState<MentionTarget | null>(null);
  const ownSession = useAppStore((state) => state.ownSession);
  // `@here` and `@everyone` only reach you in the room they were said in.
  const currentChannel = useAppStore((state) => state.currentChannel);
  const embeds = useLinkPreviews(message.message_id, message.body);
  // The card carries its own "Watch together" where it has one, so the hover
  // strip stands down rather than offering the same thing twice on one row.
  const hasEmbeds = !!embeds && embeds.length > 0;
  const allowExternal = useAppStore((state) => state.enableExternalEmbeds);
  // This message's reactions, not everybody's. The client-wide counter is what
  // makes this selector run again; the number it returns is what decides
  // whether *this* row has anything new to draw.
  const reactionVersion = useAppStore((state) =>
    state.reactionVersion >= 0 ? reactionRevision(message.message_id) : 0,
  );
  // Your own certificate, as a string. Selecting the roster for it meant every
  // mounted row re-rendered whenever anybody joined, left or muted.
  const ownHash = useAppStore(selectOwnHash) ?? "";

  // A body that has been put in cold storage is not here to be drawn: what is
  // left of it is the placeholder the backend swapped in, which carries the
  // size the original ran to and nothing else. Checked before the content is
  // read apart, because none of that reading has anything to work on.
  const offload = useMemo(() => extractOffloadInfo(message.body), [message.body]);
  const offloaded = offload !== null || restoring;

  // What the body *is* decides what gets drawn; the pictures leave it before it
  // is drawn, becoming the gallery below the bubble; only the leftover HTML is
  // sanitised, so a marker never reaches the renderer as text. And a pasted
  // link is its own anchor text, in full - set in link blue over three wrapped
  // lines it is louder than the message and than the card under it, so
  // `prettyLinks` trims what is *shown* while the href and what copy takes are
  // untouched.
  //
  // All of that is four passes over the markup, and it is cached against the
  // body rather than against this row: the render window slides constantly, so
  // the same message is mounted, dropped and mounted again while the reader
  // scrolls, and it would otherwise be read apart from scratch each time. See
  // `bodyCache`.
  const parsed = parseBody(message.body, sanitizeAndPretty);
  const content = parsed.content;
  const split = parsed;
  const body = parsed.html;
  // This message's poll, not every poll. The map is what holds them, but only
  // the store tells React that one has arrived.
  const storedPoll = useAppStore((state) =>
    content.kind === "poll" ? state.polls.get(content.pollId) : undefined,
  );
  const poll = content.kind === "poll" ? (storedPoll ?? getPoll(content.pollId)) : undefined;
  // Every marker in the body, because a batch of photographs is one message
  // with a marker each - see `messageContent`.
  const attachments = useMemo(
    () =>
      content.kind === "file"
        ? content.payloads
            .map(decodeFileAttachmentPayload)
            .filter((info): info is NonNullable<typeof info> => info !== null)
        : EMPTY_ATTACHMENTS,
    [content],
  );
  // Reactions live in a side store keyed by message id; the version counter is
  // the only thing that tells React a toggle landed.
  // `getReactions` builds and sorts a fresh array on every call, so it is asked
  // once per version rather than once per render.
  const reactions = useMemo(
    () => (message.message_id ? getReactions(message.message_id) : EMPTY_REACTIONS),
    // The counter is what says a toggle landed; the reactions themselves live
    // in a side store this hook cannot watch.
    [message.message_id, reactionVersion],
  );
  const watchSessionId = useMemo(() => readWatchMarker(message.body) ?? undefined, [message.body]);

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
  // drawn from. Nor one that is in cold storage - the text on hand is the
  // placeholder, and committing that would send it in place of the picture.
  // A local note never reached a server, so there is nothing there to edit.
  const canEdit =
    message.is_own &&
    !!message.message_id &&
    content.kind === "text" &&
    !offloaded &&
    message.channel_id !== LOCAL_NOTES_CHANNEL_ID;

  const commitEdit = (text: string) => {
    onEditingChange?.(null);
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
      const stillHere =
        chip.kind === "user" &&
        useAppStore.getState().users.some((user) => user.session === chip.session);
      if (stillHere) {
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
    // The lightbox indexes its gallery by the raw attribute (see `extractMedia`),
    // not by the absolute URL the DOM resolves it to, so ask for the same value
    // it stored. Anything the browser normalises on the way - a relative path, a
    // bare host, a space in the filename - misses the lookup otherwise, and a
    // miss is silent: the picture just refuses to open.
    const src = (target as HTMLImageElement).getAttribute("src");
    if (src) onOpenImage?.(src);
  };

  /**
   * Whether the bubble has anything to hold.
   *
   * Not whether the string is empty: a message that was only a photograph
   * still leaves behind the markup the picture sat in, and a bubble drawn
   * around a paragraph with nothing in it is an empty plate above the
   * picture. See `hasDrawableHtml`.
   */
  const hasBody = useMemo(() => hasDrawableHtml(body), [body]);
  /**
   * A message that is nothing but the link, with a card under it.
   *
   * The card is the link - it names the source, prints the title and opens
   * the same page - so the URL above it is the same fact twice, and the
   * louder of the two is the one nobody reads. The bubble becomes the
   * preview, which is what "one object" meant. A sentence with a link in it
   * keeps the sentence.
   */
  const bodyIsTheLink = useMemo(() => isOnlyLinks(body), [body]);
  /** The markup, handed to React as one object so a re-render leaves it be. */
  const bodyHtml = useInnerHtml(body);

  /** The right-hand accent bubble - only your own messages, only in "bubbles". */
  const ownBubble = message.is_own && bubbleStyle === "bubbles";
  /**
   * Whether the bubble prints the time, the tick and the failure marker under
   * it.
   *
   * The block's last message owns them - see `endsGroup`. A message that was
   * edited or refused prints its own anyway, because those two say something
   * about *this* message rather than about the run it happens to sit in, and
   * hiding either inside a group is hiding the only sign that a send failed.
   */
  const showOwnFooter = endsGroup || !!message.send_failed || !!message.edited_at;
  /** Whether the author-row body is a card. Only reached by other people's. */
  const carded = bubbleStyle === "bubbles";
  /**
   * No avatar column, and a tighter row for it.
   *
   * Compact mode and the compact message style are the same request made from
   * two settings, so either one alone is enough to drop the gutter.
   */
  const dense = compact || bubbleStyle === "compact";
  /** IRC lines: the name runs into the body instead of heading it. */
  const inlineName = bubbleStyle === "compact";
  /**
   * Whether the link preview is drawn inside the message rather than under it.
   *
   * A card standing on its own below a bubble is a second block in the river:
   * it has the same left edge and the same width as any message, so a reader
   * arriving at it has to work out which of its neighbours it belongs to -
   * and where the link was the last thing said, the answer is a guess. Inside
   * the bubble there is nothing to guess: the message and what its link turned
   * out to be are one thing, which is what they always were.
   *
   * Only where there is a bubble to go inside, and only where the message
   * still has its body: a cold-stored placeholder or an open editor is not a
   * message the card can hang off, so in those the card waits below as before.
   */
  const embedsInBubble = hasEmbeds && hasBody && !offloaded && !editing && (ownBubble || carded);
  /** Whether the text above the card is drawn at all. */
  const showBodyText = !(embedsInBubble && bodyIsTheLink);

  const openReactionPicker = (event: React.MouseEvent) => setPicker({ x: event.clientX, y: event.clientY });

  const selecting = selected !== null;
  const picked = selected === true;

  /**
   * Being mentioned marks the row and rings once.
   *
   * Nebula drew mention chips but never asked whether one pointed at the
   * reader, so a ping arrived with no highlight and - though the runtime
   * mounts the listener that plays it - no sound. The decision and the ping
   * are core's; what is Nebula's is the bar down the edge below.
   */
  const selfMention = useSelfMention(message, { ownSession, currentChannel });

  /**
   * The message menu, from wherever it was asked for: a right-click, a held
   * finger, or the strip's own button. One builder, so a phone reaches exactly
   * the actions a mouse does.
   */
  const openMenu = (point: { x: number; y: number }, row: HTMLElement, target: EventTarget | null) => {
    if (!onContextMenu) return;
    // Same bar the row's own Edit is held to: a body in cold storage has no
    // text to edit, only the placeholder standing in for it.
    onContextMenu(message, point, {
      editable: content.kind === "text" && !offloaded,
      selection: selectionTouching(row),
      image: pictureUnder(target),
      link: linkUnder(target),
    });
  };
  const longPress = useLongPress(
    (point, target, row) => openMenu(point, row, target),
    !!onContextMenu && !selecting && !editing,
  );
  // Hung under the button, so the menu opens where the finger already is.
  const openMenuFromButton = (event: React.MouseEvent) => {
    const button = event.currentTarget as HTMLElement;
    const box = button.getBoundingClientRect();
    openMenu({ x: box.left, y: box.bottom }, button.closest<HTMLElement>("[data-msg-id]") ?? button, null);
  };

  const rowHandlers = {
    // The two handles every message assertion hangs off, on the row root so
    // they are there whoever wrote it - an own bubble draws no author name to
    // put them on. Standard carries the same pair on its row and its label.
    "data-msg-id": message.message_id ?? undefined,
    "data-sender-name": message.sender_name,
    // The third handle, for the same reason as the other two: the highlight
    // is an emotion class, which neither a unit test nor an e2e run can read
    // back off the element.
    "data-self-mention": selfMention ? "1" : undefined,
    // The hover tracker measures the row to know how far its own strip stands
    // off it, so it needs the element as well as the two events.
    ref: hoverRef,
    onMouseEnter: enterRow,
    onMouseLeave: leaveRow,
    ...longPress.handlers,
    onContextMenu: (event: React.MouseEvent) => {
      if (!onContextMenu) return;
      event.preventDefault();
      // A hold already opened it; this is the webview raising its own.
      if (longPress.justFired()) return;
      openMenu({ x: event.clientX, y: event.clientY }, event.currentTarget as HTMLElement, event.target);
    },
    // Lifting the finger after a hold clicks whatever was under it - a picture
    // would open its lightbox over the menu that was just asked for.
    onClickCapture: (event: React.MouseEvent) => {
      if (!longPress.justFired()) return;
      event.preventDefault();
      event.stopPropagation();
    },
    // In selection mode the whole row is the checkbox: aiming at a small box
    // beside a wall of text is the slowest way to pick several things.
    onClick: selecting && message.message_id ? () => onToggleSelected?.(message.message_id!) : undefined,
    sx: {
      // A held finger opens the message menu, not the platform's own callout.
      WebkitTouchCallout: "none",
      // A bar down the leading edge rather than a filled row: the river is
      // already coloured by bubbles and livery, and one more tinted block in
      // it reads as another kind of message rather than as "this one is for
      // you". Standard fills; the mock's vocabulary for "attend to this" is
      // the edge marker.
      ...(selfMention
        ? {
            borderInlineStart: "2px solid",
            borderColor: "nebula.accent",
            borderRadius: radius("sm"),
            pl: "8px",
            ml: "-10px",
            background: (theme: Theme) => theme.palette.nebula.accentSoft,
          }
        : {}),
      ...(selecting
        ? {
            cursor: "pointer",
            borderRadius: radius("md"),
            // The bubble's own fill says which message is picked; the row says
            // so for everything hanging off it that is not the bubble - a
            // gallery, a body in cold storage - and nothing else is wide
            // enough to carry that.
            ...(picked ? { background: (theme: Theme) => theme.palette.nebula.accentSoft } : {}),
          }
        : {}),
    },
  };

  /**
   * The pictures this message carries, drawn as the message itself.
   *
   * Outside the bubble on purpose: a photograph in a padded, bordered panel is
   * a photograph in a frame, and several of them are a column of frames rather
   * than the one block they were sent as.
   */
  const gallery = <MediaGallery images={split.images} onOpen={onOpenImage} />;

  /** What stands in the body's place while it is away, at the size it had. */
  const coldBody = <OffloadedBody contentLength={offload?.contentLength ?? 0} restoring={restoring} />;

  const quotes = content.quoteIds.map((id) => <QuoteBlock key={id} messageId={id} onScrollTo={onJumpTo} />);

  /** Whatever the bubble did not take stays where it was, under the message. */
  const embedsBelow = hasEmbeds && !embedsInBubble;

  /** The preview as the bubble draws it, or nothing. */
  const bubbleEmbeds = embedsInBubble ? (
    <LinkPreviewCard
      attached
      bleed={showBodyText ? BUBBLE_PAD : undefined}
      ownBubble={ownBubble}
      embeds={embeds!}
      allowExternalResources={allowExternal}
      channelId={message.channel_id}
    />
  ) : null;

  /**
   * Whether anything below the body is actually drawn.
   *
   * The own-message column wraps `extras` in a right-aligning box, and an
   * empty box is still a flex child: it took a share of the column's gap on
   * every message that had no poll, no reaction and no preview, which is
   * almost all of them. Harmless while each bubble also carried a timestamp
   * line; the moment a run of them closed up, that stray gap was half the
   * space between two bubbles.
   */
  const hasExtras =
    !!poll ||
    attachments.length > 0 ||
    !!watchSessionId ||
    embedsBelow ||
    reactions.length > 0 ||
    mention !== null ||
    picker !== null;

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
      {/* A photograph in this river is the message, not a file that happens
          to be one: it hangs at its own shape with nothing framing it, and a
          batch sent together is one block - the same treatment an image typed
          into the body gets. */}
      <AttachmentGallery attachments={attachments} />
      {watchSessionId && <WatchMarker sessionId={watchSessionId} />}
      {embedsBelow && (
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

  /**
   * The accent plate, drawn on whichever element is actually the bubble.
   *
   * With a preview inside, that is a shell holding the text and the card;
   * without one it is the text itself, and keeping the plain message a single
   * element is what stops this change from re-shaping every message that
   * carries no link.
   */
  const ownSurfaceSx = (theme: Theme) => ({
    maxWidth: "min(620px, 78%)",
    px: `${BUBBLE_PAD.x}px`,
    py: "9px",
    borderRadius: `${radius("lg")} ${radius("lg")} ${radius("sm")} ${radius("lg")}`,
    // Edge and fill together, because a skin may cut the bubble's corners: a
    // real `border` is sliced off at the diagonal and leaves the cut
    // unstroked, so the edge is drawn as a ground with the fill inset 1px
    // over it. That is a plain 1px border on the skins that cut nothing, so
    // there is one path here rather than two.
    // Which of the two the skin asks for: a wash of the accent over the
    // canvas, or the accent itself with its own ink. A solid plate states no
    // second edge colour - the drawn skins that take it set a 2px hairline,
    // and a lighter blue ring around a blue bubble reads as a halo it never
    // had.
    ...(theme.palette.nebulaSkin.bubbleOwn === "solid"
      ? {
          ...bubbleSurface(theme, theme.palette.nebula.accent, theme.palette.nebula.accent, picked),
          color: theme.palette.nebula.onAccent,
        }
      : bubbleSurface(theme, theme.palette.nebula.accentSoft, theme.palette.nebula.accentLine, picked)),
  });

  if (ownBubble) {
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
            onEdit={canEdit ? () => onEditingChange?.(message.message_id ?? null) : undefined}
            onQuote={message.message_id ? () => onQuote?.(message) : undefined}
            onReact={message.message_id ? openReactionPicker : undefined}
            onMore={onContextMenu ? openMenuFromButton : undefined}
          />
        )}
        {quotes}
        {editing ? (
          <BodyEditor
            initial={editableText(message.body)}
            onCommit={commitEdit}
            onCancel={() => onEditingChange?.(null)}
          />
        ) : offloaded ? (
          coldBody
        ) : (
          // The handler and the body's own typography stay on the text: the
          // card below carries a picture of its own, and a handler over the
          // pair would open the lightbox on it.
          hasBody && (
            <BubbleShell
                sx={
                  embedsInBubble
                    ? (theme) => ({
                        ...ownSurfaceSx(theme),
                        // A floor, not a width: sized to the sentence above
                        // it, the same preview is a different shape on every
                        // message that quotes the same link - and a long one
                        // still gets to run out to the bubble's full width.
                        minWidth: "min(460px, 78%)",
                        // The nine points under a line of prose are not
                        // enough under a card: the thumbnail and the button
                        // are hard edges, and they sit on the bubble's rim
                        // without this.
                        pb: `${BUBBLE_PAD.bottom}px`,
                        // With no text above it the poster is the whole
                        // bubble, so there is nothing left to pad: the
                        // padding would be a bare strip of the accent above
                        // the picture, which is what a bubble with its
                        // sentence removed looks like.
                        ...(showBodyText ? {} : { p: 0 }),
                      })
                    : undefined
                }
                below={bubbleEmbeds}
              >
                {showBodyText && (
                  <Box
                    onClick={onBodyClick}
                    sx={(theme) => ({
                      ...(embedsInBubble ? {} : ownSurfaceSx(theme)),
                      lineHeight: 1.55,
                      wordBreak: "break-word",
                      "& img": {
                        maxWidth: "100%",
                        borderRadius: radius("lg"),
                        display: "block",
                        cursor: "zoom-in",
                      },
                      "& a": {
                        color:
                          theme.palette.nebulaSkin.bubbleOwn === "solid"
                            ? theme.palette.nebula.onAccent
                            : theme.palette.nebula.accent,
                        // No underline: at this size, in the accent, on its own
                        // line, a link is already unmistakably a link, and the
                        // rule under a trimmed URL is what made it shout.
                        textDecoration: "none",
                        "&:hover": { textDecoration: "underline" },
                        // One line, always: even trimmed, a link next to a long
                        // word can be pushed past the bubble, and a URL that
                        // wraps is the noise this was trimmed to stop.
                        display: "inline-block",
                        maxWidth: "100%",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        verticalAlign: "bottom",
                      },
                      ...bodyMarkupSx(theme),
                      ...mentionSx(theme),
                    })}
                    dangerouslySetInnerHTML={bodyHtml}
                  />
                )}
              </BubbleShell>
          )
        )}
        {gallery}
        {hasExtras && (
          <Box
            sx={{
              maxWidth: "min(620px, 78%)",
              width: "100%",
              display: "flex",
              // A column, because `extras` is several things and not one: an
              // attachment card, a poll, a preview and the reactions are all
              // siblings here, and in a row the reaction pills landed beside
              // the card they belong to - stretched to its full height, since
              // that is what a flex row does to an item next to a taller one.
              // They hang under the message, as they do on the other side.
              flexDirection: "column",
              // Each one keeps its own width and hugs the message's edge
              // rather than being stretched to the column - a file card
              // pulled out to 78% of the river is a different card.
              alignItems: "flex-end",
            }}
          >
            {extras}
          </Box>
        )}
        {alwaysShowActions && !editing && (
          <RowActions
            watchOnCard={hasEmbeds}
            pinned
            message={message}
            align="right"
            onEdit={canEdit ? () => onEditingChange?.(message.message_id ?? null) : undefined}
            onQuote={message.message_id ? () => onQuote?.(message) : undefined}
            onReact={message.message_id ? openReactionPicker : undefined}
            onMore={onContextMenu ? openMenuFromButton : undefined}
          />
        )}
        {showOwnFooter && (
          <Stack direction="row" alignItems="center" gap={0.5}>
            <Typography sx={stampSx}>
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
                allMessageIds={allMessageIds ?? EMPTY_IDS}
              />
            )}
            {message.send_failed && (
              <Box sx={(theme) => ({ display: "flex", color: theme.palette.nebula.bad })}>
                <WarningIcon width={11} height={11} />
              </Box>
            )}
          </Stack>
        )}
      </Stack>
    );
  }

  // The author's name, as a handle on their card. Shared by the block header
  // and the compact style's inline run, so the two cannot drift apart.
  const authorName = (
    <Typography
      component="button"
      data-testid={TID.chatMessageSender}
      data-sender-name={message.sender_name}
      onClick={(event) => message.sender_session != null && onOpenProfile(message.sender_session, event)}
      {...authorHandlers}
      sx={{ all: "unset", cursor: "pointer", fontWeight: 600, fontSize: 13 }}
    >
      {message.sender_name}
    </Typography>
  );

  // Whoever wrote it, the header carries a time: the block header is the only
  // place the left-hand column has for one, and a name with nothing beside it
  // is a message that reads as having happened at no particular moment.
  const stamp = (
    <Typography component="span" sx={stampSx}>
      {formatTime(message.timestamp, time)}
      {message.edited_at ? t("nebulaChat:row.edited") : ""}
    </Typography>
  );

  const pluginBadge = message.plugin_name ? (
    <Typography
      component="span"
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
  ) : null;

  // Sent by a client without the channel's encryption, so this copy crossed the
  // server in the clear. Standard marks it with the same word.
  const legacyBadge = message.is_legacy ? (
    <Tooltip title={t("nebulaChat:row.legacyHint")}>
      <Typography
        component="span"
        data-legacy-badge=""
        sx={(theme) => ({
          fontSize: 9.5,
          fontWeight: 600,
          px: "6px",
          borderRadius: radius("sm"),
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          background: alpha(theme.palette.nebula.warn, 0.14),
          color: theme.palette.nebula.warn,
        })}
      >
        {t("chat:message.legacyBadge")}
      </Typography>
    </Tooltip>
  ) : null;

  /**
   * The receipt and the failure marker, for your own message drawn down here.
   *
   * Outside "bubbles" your message has no right-hand column, and with it goes
   * the footer those two used to sit in - so they join the header rather than
   * quietly vanishing for two of the three styles.
   */
  const ownMarkers = message.is_own ? (
    <Stack direction="row" alignItems="center" gap={0.5} sx={{ alignSelf: "center", display: "inline-flex" }}>
      {!message.send_failed && message.message_id && !message.dm_session && (
        <ReadReceiptIndicator
          messageId={message.message_id}
          channelId={message.channel_id}
          allMessageIds={allMessageIds ?? EMPTY_IDS}
        />
      )}
      {message.send_failed && (
        <>
          <Box sx={(theme) => ({ display: "flex", color: theme.palette.nebula.bad })}>
            <WarningIcon width={11} height={11} />
          </Box>
          <Typography component="span" sx={(theme) => ({ fontSize: 10.5, color: theme.palette.nebula.bad })}>
            {t("nebulaChat:row.failed")}
          </Typography>
        </>
      )}
    </Stack>
  ) : null;

  return (
    <Stack
      direction="row"
      gap={`${dense ? ROW_GAP_PX.dense : ROW_GAP_PX.roomy}px`}
      {...rowHandlers}
      sx={{ position: "relative", minWidth: 0, ...(rowHandlers.sx ?? {}) }}
    >
      {hovered && !editing && !alwaysShowActions && (
        <RowActions
          watchOnCard={hasEmbeds}
          message={message}
          // This row is drawn from the left, and in "bubbles" somebody else's
          // card is only as wide as what they said - so a pill pinned to the
          // right edge floats in empty canvas half a screen from the message
          // it acts on. It hangs off the body's own left edge instead, past
          // the avatar gutter, which is where the pinned strip below already
          // puts itself.
          align="left"
          inset={dense ? 0 : AVATAR_COLUMN_PX + ROW_GAP_PX.roomy}
          onEdit={canEdit ? () => onEditingChange?.(message.message_id ?? null) : undefined}
          onQuote={message.message_id ? () => onQuote?.(message) : undefined}
          onReact={message.message_id ? openReactionPicker : undefined}
          onMore={onContextMenu ? openMenuFromButton : undefined}
        />
      )}
      {/* Compact drops the column rather than leaving a 38px gutter with
          nothing in it: the width is the avatar, not an indent. The gutter
          stays even when the list has hoisted the picture out of it - what
          the list draws is an overlay, and the text still has to make room. */}
      {!dense && (
        <Box sx={{ width: AVATAR_COLUMN_PX, flex: "none" }}>
          {!grouped && !stickyAvatar && (
            <MessageAvatar
              message={message}
              avatar={avatar}
              onOpenProfile={onOpenProfile}
              onHoverProfile={onHoverProfile}
              onLeaveProfile={onLeaveProfile}
              onContextMenuProfile={onContextMenuProfile}
            />
          )}
        </Box>
      )}
      <Box sx={{ minWidth: 0, flex: 1 }}>
        {!grouped && !inlineName && (
          <Stack direction="row" alignItems="baseline" gap={1}>
            {authorName}
            {stamp}
            {pluginBadge}
            {legacyBadge}
            {ownMarkers}
          </Stack>
        )}
        {quotes}
        {/* The compact style's header is a run of inline text rather than a
            line of its own - that is the whole of what "compact" buys, and it
            only works if the body joins it below. */}
        {!grouped && inlineName && (
          <Box component="span" sx={{ mr: "6px", whiteSpace: "nowrap" }}>
            {stamp} {authorName}
            {pluginBadge}
            {legacyBadge}
            {ownMarkers}
          </Box>
        )}
        {editing ? (
          <BodyEditor
            align="left"
            initial={editableText(message.body)}
            onCommit={commitEdit}
            onCancel={() => onEditingChange?.(null)}
          />
        ) : offloaded ? (
          coldBody
        ) : (
          hasBody && (
              <BubbleShell
                sx={
                  embedsInBubble
                    ? (theme) => ({
                        mt: grouped ? 0 : "2px",
                        // Wide enough for the card, and no wider than any
                        // other bubble - see the own side for why it is a
                        // floor rather than a width.
                        width: "fit-content",
                        minWidth: "min(460px, 100%)",
                        maxWidth: "min(620px, 100%)",
                        px: `${BUBBLE_PAD.x}px`,
                        pt: "9px",
                        // See the own side: a card wants more under it than
                        // a sentence does.
                        pb: `${BUBBLE_PAD.bottom}px`,
                        // And no padding at all where the poster is the whole
                        // bubble; see the own side.
                        ...(showBodyText ? {} : { p: 0 }),
                        borderRadius: `${radius("lg")} ${radius("lg")} ${radius("lg")} ${radius("sm")}`,
                        ...bubbleSurface(theme, theme.palette.nebula.card, theme.palette.nebula.line, picked),
                      })
                    : undefined
                }
                below={bubbleEmbeds}
              >
                {showBodyText && (
                  <Box
                    onClick={onBodyClick}
                    sx={(theme) => ({
                      ...(embedsInBubble ? {} : { mt: grouped || inlineName ? 0 : "2px" }),
                      lineHeight: 1.55,
                      wordBreak: "break-word",
                      // "Bubbles" means every message in a rounded card, not only
                      // yours: this one takes the surface colour and hangs its tail
                      // on the left, mirroring the accent bubble on the right.
                      // With a preview inside, the shell above is that card and
                      // the body is only the text in it.
                      ...(carded && !embedsInBubble
                        ? {
                            width: "fit-content",
                            maxWidth: "min(620px, 100%)",
                            px: "14px",
                            py: "9px",
                            borderRadius: `${radius("lg")} ${radius("lg")} ${radius("lg")} ${radius("sm")}`,
                            ...bubbleSurface(
                              theme,
                              theme.palette.nebula.card,
                              theme.palette.nebula.line,
                              picked,
                            ),
                          }
                        : {}),
                      // Compact runs the body into the name above it.
                      ...(inlineName ? { display: "inline" } : {}),
                      // Pictures are lifted out before this renders, so this is
                      // only a floor under anything that somehow arrives as markup
                      // the splitter did not see - and it matches the gallery
                      // rather than the cramped thumbnail it used to be.
                      "& img": {
                        maxWidth: "min(420px, 100%)",
                        maxHeight: 320,
                        borderRadius: radius("lg"),
                        display: "block",
                        mt: "8px",
                        cursor: "zoom-in",
                      },
                      "& a": {
                        color: theme.palette.nebula.accent,
                        // One line, always: even trimmed, a link next to a long
                        // word can be pushed past the bubble, and a URL that
                        // wraps is the noise this was trimmed to stop.
                        display: "inline-block",
                        maxWidth: "100%",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        verticalAlign: "bottom",
                      },
                      ...bodyMarkupSx(theme),
                      ...mentionSx(theme),
                    })}
                    dangerouslySetInnerHTML={bodyHtml}
                  />
                )}
              </BubbleShell>
          )
        )}
        {gallery}
        {extras}
        {alwaysShowActions && !editing && (
          <RowActions
            watchOnCard={hasEmbeds}
            pinned
            message={message}
            align="left"
            onEdit={canEdit ? () => onEditingChange?.(message.message_id ?? null) : undefined}
            onQuote={message.message_id ? () => onQuote?.(message) : undefined}
            onReact={message.message_id ? openReactionPicker : undefined}
            onMore={onContextMenu ? openMenuFromButton : undefined}
          />
        )}
      </Box>
    </Stack>
  );
});

/**
 * The bubble around a body that has a preview under it - and nothing at all
 * where it has none.
 *
 * Without this the row would need two spellings of the same body, one wrapped
 * and one bare, and the two would drift. A `sx` of `undefined` means "no
 * bubble to draw": the children are handed straight back, so the styles the
 * body carries for the flat and compact styles land on the same element they
 * always did.
 */
/**
 * The padding of a bubble that holds a preview, in points.
 *
 * Stated once because two things depend on it: the shell that applies it, and
 * the poster inside, which cancels it to reach the bubble's own edges. A
 * poster that cancels a number this file has since changed leaves a strip of
 * the bubble showing under it, which is what a hardcoded pair of margins did.
 */
export const BUBBLE_PAD = { x: 14, bottom: 12 };

function BubbleShell({
  sx,
  below,
  children,
}: Readonly<{
  sx?: (theme: Theme) => object;
  below: React.ReactNode;
  children: React.ReactNode;
}>) {
  if (!sx) return <>{children}</>;
  return (
    <Box sx={sx}>
      {children}
      {below}
    </Box>
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
  align = "right",
}: Readonly<{
  initial: string;
  onCommit: (text: string) => void;
  onCancel: () => void;
  /** Which side the box and its hint hang off - the bubble's, or the river's. */
  align?: "left" | "right";
}>) {
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
    <Stack
      alignItems={align === "right" ? "flex-end" : "flex-start"}
      gap={0.5}
      sx={{ maxWidth: align === "right" ? "min(620px, 78%)" : "min(620px, 100%)", width: "100%" }}
    >
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
          border: `var(--nebula-line-width, 1px) solid ${theme.palette.nebula.accent}`,
        })}
      />
      <Typography sx={(theme) => ({ fontSize: 10, color: theme.palette.nebula.dim })}>
        {t("nebulaChat:row.editHint")}
      </Typography>
    </Stack>
  );
}

/**
 * What the reader has highlighted, if the highlight touches this row.
 *
 * A selection that runs across several messages belongs to all of them, so any
 * of the rows it crosses may offer to copy the whole of it; a selection
 * somewhere else entirely is not this row's to offer. Chromium has already
 * collapsed the selection by the time a right-click outside one reaches us,
 * which is what makes "no selection" answer itself.
 */
function selectionTouching(row: HTMLElement): string {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return "";
  const text = selection.toString().trim();
  if (!text) return "";
  for (let index = 0; index < selection.rangeCount; index += 1) {
    if (selection.getRangeAt(index).intersectsNode(row)) return text;
  }
  return "";
}

/**
 * The picture the pointer was over, or null.
 *
 * A message row is full of `<img>` - the author's avatar, an emote in the
 * line, the thumbnail on a link card - and almost none of them is a picture
 * anybody wants to save. Only the ones the galleries mark as one answer here,
 * which is also what keeps the blurred copy behind a framed photograph out:
 * it is the same picture twice, and only one of them is the picture.
 *
 * The `src` is read off the attribute rather than the property, because that
 * is the spelling the lightbox and the galleries both index by - see
 * `onBodyClick`.
 */
function pictureUnder(target: EventTarget | null): MenuImage | null {
  if (!(target instanceof Element)) return null;
  const picture = target.closest<HTMLImageElement>("img[data-picture]");
  const src = picture?.getAttribute("src");
  if (!src) return null;
  return {
    src,
    alt: picture?.getAttribute("alt") ?? "",
    link: picture?.getAttribute("data-picture-link") ?? null,
  };
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
  onMore,
  align,
  inset = 0,
  pinned = false,
  watchOnCard = false,
}: Readonly<{
  message: ChatMessage;
  onEdit?: () => void;
  onQuote?: () => void;
  onReact?: (event: React.MouseEvent) => void;
  /**
   * Open the full message menu. The strip holds the few actions wanted
   * mid-conversation; everything else is in the menu, and without this a touch
   * screen - which has no right-click - could not reach it.
   */
  onMore?: (event: React.MouseEvent) => void;
  /** True where the link preview under the message already offers it. */
  watchOnCard?: boolean;
  /** Which edge of the bubble the pill hangs from. */
  align: "left" | "right";
  /**
   * How far in from that edge, in px.
   *
   * The pill is positioned against the whole row, which on a left-hand
   * message begins with the avatar gutter - so "flush left" would hang it off
   * the picture rather than off what was said. The row hands over the width
   * of the chrome it has to clear.
   */
  inset?: number;
  /**
   * Drawn in the flow under its own message instead of floating over the row
   * above - what "always show message actions" asks for. Floating is only safe
   * for the one row the pointer is on.
   */
  pinned?: boolean;
}>) {
  const { t } = useTranslation(["nebulaChat", "chat", "common"]);
  const canModerate = message.is_own && !!message.message_id;
  // Notes on this device: nothing to react to, pin or watch on a server.
  const local = message.channel_id === LOCAL_NOTES_CHANNEL_ID;
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
    <>
      {/* The gap is air to look at, not to walk through: the pointer crossing
          it has to stay inside the row, or the row stops being hovered and the
          pill is gone before it is reached. The bridge used to be the pill's
          own edge, and so was only as wide as the pill - which left the rest
          of the row's top edge a trapdoor, and reaching the pill from anywhere
          but straight below it a matter of moving fast enough. It spans the
          whole row instead. A child of the row, so the pointer resting on it
          is still the pointer on this message; drawn only while the pill is
          up, so it covers nothing the reader could otherwise be clicking. */}
      {!pinned && (
        <Box
          aria-hidden
          sx={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: "100%",
            height: `${PILL_GAP}px`,
            zIndex: 2,
          }}
        />
      )}
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
                ...(align === "right" ? { right: inset } : { left: inset }),
                zIndex: 2,
                height: 34,
                backdropFilter: "blur(30px)",
                WebkitBackdropFilter: "blur(30px)",
              }),
          width: "fit-content",
          px: "12px",
          borderRadius: radius("lg"),
          ...floatingSurface(theme),
          color: theme.palette.nebula.muted,
        })}
      >
        {onReact && !local && (
          <PillButton label={t("chat:reactions.add")} onClick={onReact} icon={EmojiPlusIcon} />
        )}
        {onQuote && (
          <PillButton label={t("nebulaChat:row.replyToMessage")} onClick={onQuote} icon={QuoteIcon} />
        )}
        {onEdit && <PillButton label={t("nebulaChat:row.editMessage")} onClick={onEdit} icon={EditIcon} />}
        <PillButton
          label={t("chat:inlineActions.copy")}
          onClick={() => void navigator.clipboard?.writeText(bodyToCopyText(message.body))}
          icon={CopyIcon}
        />
        {message.message_id && !local && (
          <PillButton
            label={message.pinned ? t("chat:pinned.unpinAriaLabel") : t("nebulaChat:row.pinMessage")}
            onClick={() =>
              void useAppStore
                .getState()
                .pinMessage(message.channel_id, message.message_id!, !!message.pinned)
            }
            icon={message.pinned ? CheckIcon : PinIcon}
          />
        )}
        {canWatchTogether && !watchOnCard && !local && (
          <PillButton
            label={watchBusy ? t("chat:contextMenu.watchTogetherBusy") : t("chat:contextMenu.watchTogether")}
            onClick={() => void startWatch()}
            icon={PlayIcon}
          />
        )}
        {onMore && (
          <PillButton
            label={t("common:messageActionBar.moreOptions")}
            onClick={onMore}
            icon={KebabMenuIcon}
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
                void (local
                  ? useAppStore.getState().deleteLocalNotes([message.message_id!])
                  : useAppStore
                      .getState()
                      .deletePchatMessages(message.channel_id, { messageIds: [message.message_id!] }))
              }
              icon={TrashIcon}
              danger
            />
          </>
        )}
      </Stack>
    </>
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
