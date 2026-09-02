import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Stack } from "../primitives";
import { Box, IconButton, Menu, MenuItem, Tooltip, Typography } from "@mui/material";
import { alpha, type SxProps, type Theme } from "@mui/material/styles";
import { useTypingIndicator } from "@core/features/chat/typing/useTypingIndicator";
import { sendPluginInteraction, useAppStore } from "@core/store";
import { parseMentionTrigger, type MentionTrigger } from "@core/utils/mentions";
import { collectSlashCommands, filterSlashCommands } from "@core/plugins/tier1/manifest";
import { extractSlashQuery, parseSlashLine } from "@core/plugins/tier1/slashParser";
import {
  AttachIcon,
  ChevronDownIcon,
  CloseIcon,
  FileTextIcon,
  ImageIcon,
  PollIcon,
  SendIcon,
  UploadIcon,
} from "@ui/icons";
import { FormatBar, type FormatAction } from "./FormatBar";
import { PopoverPanel, PopoverScrim } from "./popover/PopoverPanel";
import { GIF_POPOVER_WIDTH, GifPopover } from "./popover/GifPopover";
import { EMOJI_POPOVER_WIDTH, EmojiPopover } from "./popover/EmojiPopover";
import { POLL_POPOVER_WIDTH, PollPopover } from "./popover/PollPopover";
import {
  AttachmentTray,
  DEFAULT_SHARE_OPTIONS,
  extension,
  shareOptionsReady,
  type ShareOptions,
} from "./AttachmentTray";
// The keys and the wire format a mention becomes are shared with Standard;
// only the list itself is redrawn here.
import {
  candidateInsertText,
  handleMentionKey,
  type MentionCandidate,
} from "@standard/components/chat/mention/MentionAutocomplete";
import MentionAutocomplete from "./MentionAutocomplete";
import { useMentionCandidates } from "@standard/components/chat/mention/useMentionCandidates";
import { handleSlashKey } from "@standard/components/plugin/SlashCommandMenu";
import SlashCommandMenu from "./SlashCommandMenu";
import MarkdownInput, { type MarkdownInputApi } from "@standard/components/chat/markdown/MarkdownInput";
import type { ChatMessage } from "@core/types";
import type { StagedAttachment, UploadPlaceholder } from "@core/features/chat/useFileUpload";
import { formatBytes } from "@core/utils/format";
import { composerHtml, plainText } from "../../selectors";
import { glassChrome } from "../../theme";
import { CHAT_COLUMN_INSET_PX, CHAT_COLUMN_MAX_WIDTH, NEBULA_MONO, radius } from "../../tokens";

/** What the paperclip asks the picker for. */
export type AttachKind = "any" | "media";

interface ComposerProps {
  /** Placeholder target, e.g. "#Gaming" or "@Lorelando". */
  target: string;
  disabled?: boolean;
  onSend: (html: string) => void | Promise<void>;
  /** Open the file picker. Files it returns land in the tray straight away. */
  onAttach?: (kind: AttachKind) => void;
  /**
   * Images pasted or dropped into the browser itself, staged the moment they
   * land - no picker, no question asked first.
   *
   * Distinct from `onAttach`: those files already have a path on disk, and a
   * paste is bytes the webview is holding instead. The composer only reads
   * them off the clipboard; where they end up on disk is not its concern.
   */
  onAttachFiles?: (files: File[]) => void;
  /**
   * Why files cannot be sent here, or null when they can.
   *
   * The button is drawn either way. Hiding it left no way to tell a server
   * that refuses attachments from a client that has lost track of whether it
   * can send them - the reader just sees a gap where a paperclip should be.
   */
  attachBlocked?: string | null;
  /** Post a poll. Absent in DMs, which have no channel to poll. */
  onCreatePoll?: (question: string, options: string[], multiple: boolean) => void;
  /** Open a Live Doc for this channel. Absent in DMs and wherever the server
   *  has no live-doc plugin loaded, which is what hides the entry. */
  onOpenLiveDoc?: () => void;
  /** Whether this server lets a file be reached by link, which is what makes visibility a choice. */
  canSharePublic?: boolean;
  /** Whether this server honours a lifetime on a share at all. */
  canExpire?: boolean;
  /** How the staged files go up, as chosen on the tray. */
  shareOptions?: ShareOptions;
  onShareOptionsChange?: (next: ShareOptions) => void;
  /** Messages this one is replying to, drawn above the text. */
  quotes?: readonly ChatMessage[];
  onRemoveQuote?: (messageId: string) => void;
  /** Files picked or dropped, waiting on the message that sends them. */
  attachments?: readonly StagedAttachment[];
  onRemoveAttachment?: (id: string) => void;
  /** Uploads in flight, drawn as a tray above the text. */
  uploads?: readonly UploadPlaceholder[];
  onCancelUpload?: (id: string) => void;
  /**
   * True while files are being dragged over the window.
   *
   * Driven from outside because the paths come from Tauri's own drag-drop
   * event: a dropped `File` in the DOM has no path on disk, and the uploader
   * streams from a path.
   */
  dropActive?: boolean;
}

/**
 * The design's own geometry, kept as its own constants.
 *
 * These are the numbers the artboard repeats - a 24px panel, 16px tiles, a
 * blur heavy enough to separate by light rather than by shadow - and they sit
 * outside the pack's radius scale on purpose: the scale tops out at 20 and
 * this surface is drawn to a different one. Colour still comes from the theme,
 * so the composer follows the user's scheme and accent rather than pinning the
 * artboard's two.
 */
/** The inset that lets the wallpaper show around all four sides. */
const PANEL_INSET_PX = CHAT_COLUMN_INSET_PX;
const PANEL_INSET = `${PANEL_INSET_PX}px`;
/**
 * Where the composer stops growing.
 *
 * About a 16:9 pane. Past that an ultrawide window would stretch one line of
 * text across a metre of glass; below it nothing changes, so a laptop keeps
 * the inset edge to edge.
 */
const PANEL_MAX_WIDTH = CHAT_COLUMN_MAX_WIDTH;
/** The panels that can hang off the composer; "notice" is the one that only says why files cannot be sent. */
type PopoverKind = "emoji" | "gif" | "poll" | "notice";

/** A panel that only has a sentence to say is narrower than one you act in. */
const NOTICE_POPOVER_WIDTH = 300;
const PANEL_RADIUS = "16px";
const PANEL_BLUR = "blur(32px) saturate(160%)";

const POPUP = {
  position: "absolute",
  bottom: "100%",
  left: PANEL_INSET,
  right: PANEL_INSET,
  zIndex: 20,
  // The lists inside are in flow, so the gap above the composer is the
  // slot's to keep - the surfaces themselves are reusable anywhere.
  pb: "6px",
} as const;

/**
 * The formatting bar sits at the height the lists do, but not at their width.
 *
 * The lists are pickers and fill the pane so their rows are readable; a bar of
 * icons stretched to an ultrawide window would be seven buttons and a metre of
 * empty glass. So it keeps its own width and is centred over the words it is
 * about - `left` is set per selection and the transform does the centring.
 */
const FORMAT_BAR = {
  position: "absolute",
  bottom: "100%",
  zIndex: 20,
} as const;

/**
 * The composer pill.
 *
 * The mock's composer is one rounded bar floating over the message river, with
 * the send action as a filled accent disc rather than a labelled button. Enter
 * sends and Shift+Enter breaks the line, which is what the rest of the app
 * does; the textarea grows to a few lines and then scrolls.
 *
 * The editable surface is Standard's `MarkdownInput` - an invisible textarea
 * under a decorated overlay, so what is typed is formatted as it is typed. It
 * is borrowed rather than redrawn because it is an editor, not layout, and a
 * second one would be a second markdown dialect to keep honest.
 *
 * Three things can be open over it while typing - the mention list, the slash
 * command list, the emoji grid - and all three are pickers, so all three are
 * Standard's too. What is Nebula's is the pill around them, and the bookkeeping
 * that decides when a list should open.
 */
/** The namespaces this composer reads, so the helper below takes the same `t`. */
const COMPOSER_NS = ["nebulaChat", "chat", "settings"] as const;
type ComposerT = ReturnType<typeof useTranslation<typeof COMPOSER_NS>>["t"];

export function Composer({
  target,
  disabled = false,
  onSend,
  onAttach,
  onAttachFiles,
  attachBlocked = null,
  onCreatePoll,
  onOpenLiveDoc,
  canSharePublic = false,
  canExpire = false,
  shareOptions = DEFAULT_SHARE_OPTIONS,
  onShareOptionsChange,
  quotes = [],
  onRemoveQuote,
  attachments = [],
  onRemoveAttachment,
  uploads = [],
  onCancelUpload,
  dropActive = false,
}: Readonly<ComposerProps>) {
  const [draft, setDraft] = useState("");
  /**
   * Whether the editor holds focus.
   *
   * Kept here rather than left to the editor because the panel is what has to
   * light: the pill *is* the field, so `:focus-within` would have to be said
   * on it anyway, and a boolean also serves the placeholder and the caret,
   * which are drawn by the editor and coloured from out here.
   */
  const { t } = useTranslation(COMPOSER_NS);
  const [focused, setFocused] = useState(false);
  /**
   * Which popover is open and where its icon is.
   *
   * One piece of state for all of them: they occupy the same space above the
   * composer, so two open at once is never a thing to represent - and each
   * hangs off the icon that opened it rather than off the panel's edge.
   */
  const [popover, setPopover] = useState<{ kind: PopoverKind; left: number } | null>(null);
  /**
   * The element the attach menu hangs off, while it is open.
   *
   * The paperclip itself goes straight to the picker - that is what it is
   * pressed for nineteen times in twenty. The rest of what can be attached
   * lives in a small menu behind the chevron beside it, or behind a
   * right-click on the clip. Holding the element rather than a boolean gives
   * the menu its anchor and gives whatever it opens the same anchor, so a
   * poll opened from the menu still lines up with the row's buttons.
   */
  const [attachMenu, setAttachMenu] = useState<HTMLElement | null>(null);
  // Anything the menu could still offer once files are refused: a poll and a
  // document are neither of them a file.
  const hasAttachMenu = !attachBlocked || Boolean(onCreatePoll) || Boolean(onOpenLiveDoc);
  /** The paperclip itself, for a panel that opens without it being pressed. */
  const attachButton = useRef<HTMLButtonElement>(null);
  /**
   * The run of the draft that is selected, or null when none is.
   *
   * Kept as state rather than read off `caret`, which is a ref: the bar has to
   * appear when the selection does, and a ref changing renders nothing. The
   * offsets themselves are what re-run the measurement below, so moving a
   * selection without changing its length still moves the bar.
   */
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  /** Where the bar's centre goes, in pixels from the shell's left edge. */
  const [barLeft, setBarLeft] = useState<number | null>(null);
  const shell = useRef<HTMLDivElement>(null);

  /** Anchor a popover to one of the row's buttons, clamped inside the pane. */
  const openPopoverFrom = (kind: PopoverKind, button: HTMLElement | null, width: number) =>
    setPopover({ kind, left: popoverLeft(shell.current, button, width) });
  /** The same, for the button that was just pressed. */
  const openPopover = (kind: PopoverKind, event: React.MouseEvent<HTMLElement>, width: number) =>
    openPopoverFrom(kind, event.currentTarget, width);
  const editor = useRef<MarkdownInputApi | null>(null);
  /** Where the caret is, as the editor last reported it. */
  const caret = useRef({ start: 0, end: 0 });
  /**
   * The draft as of this very moment.
   *
   * The editor calls `onChange` and then `onSelectionChange` inside one
   * handler, so neither callback alone has both the new text and the new
   * caret: state has not re-rendered in between. This ref is written by the
   * first so the second can read what was actually typed.
   */
  const draftRef = useRef("");
  const { notifyTyping, resetTyping } = useTypingIndicator();

  const selectedChannel = useAppStore((state) => state.selectedChannel);
  const users = useAppStore((state) => state.users);
  // The editor draws `<@7>` as a chip rather than as markup, which needs a
  // name for the session behind it.
  const mentionName = useCallback(
    (session: number) => users.find((user) => user.session === session)?.name,
    [users],
  );
  const pluginManifests = useAppStore((state) => state.pluginManifests);

  const [trigger, setTrigger] = useState<MentionTrigger | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const candidates = useMentionCandidates(trigger?.kind ?? null, trigger?.query ?? "");

  const [slashIndex, setSlashIndex] = useState(0);
  const allSlash = useMemo(() => collectSlashCommands(pluginManifests), [pluginManifests]);
  const slashQuery = extractSlashQuery(draft);
  const slashEntries = useMemo(
    () => (slashQuery === null ? [] : filterSlashCommands(allSlash, slashQuery)),
    [allSlash, slashQuery],
  );
  const slashOpen = slashQuery !== null && slashEntries.length > 0;

  useEffect(() => {
    if (mentionIndex >= candidates.length) setMentionIndex(0);
  }, [candidates.length, mentionIndex]);
  useEffect(() => {
    if (slashIndex >= slashEntries.length) setSlashIndex(0);
  }, [slashEntries.length, slashIndex]);

  // A trigger survives only as long as the "@" it started at does. Deleting
  // that character but leaving the word behind would otherwise keep a list
  // open over letters that are no longer a mention.
  useEffect(() => {
    if (trigger && draft.charAt(trigger.anchor) !== "@") setTrigger(null);
  }, [draft, trigger]);

  /** Replace the given span of the draft, leaving the caret after the insert. */
  const replaceRange = useCallback((from: number, to: number, text: string) => {
    editor.current?.replaceRange(from, to, text);
  }, []);

  const insertAtCaret = useCallback(
    (text: string) => replaceRange(caret.current.start, caret.current.end, text),
    [replaceRange],
  );

  const pickMention = useCallback(
    (candidate: MentionCandidate) => {
      if (!trigger) return;
      // A role trigger is typed as "@&name" and every other kind as "@name",
      // so the trigger's own kind is what says how many characters the query
      // occupies and therefore how much of the draft this replaces.
      const typed = trigger.kind === "role" ? trigger.query.length + 2 : trigger.query.length + 1;
      replaceRange(trigger.anchor, trigger.anchor + typed, candidateInsertText(candidate) + " ");
      setTrigger(null);
    },
    [replaceRange, trigger],
  );

  const pickSlash = useCallback(
    (entry: { command: { name: string } }) => {
      const leading = draft.length - draft.trimStart().length;
      const next = draft.slice(0, leading) + "/" + entry.command.name + " ";
      draftRef.current = next;
      setDraft(next);
      setSlashIndex(0);
    },
    [draft],
  );

  /**
   * Re-read the mention trigger for `text` at the given caret.
   *
   * The text is passed in rather than read from state: the editor reports a
   * selection during its own change event, when `draft` still holds the value
   * from before the keystroke. Parsing that would look for the trigger in the
   * previous text and find nothing, leaving the popup to depend on a later
   * selection event that a programmatic edit never fires.
   */
  const updateTrigger = useCallback((text: string, start: number, end: number) => {
    caret.current = { start, end };
    setSelection(start === end ? null : { start, end });
    if (start !== end) {
      setTrigger((previous) => (previous ? null : previous));
      return;
    }
    const next = parseMentionTrigger(text, start);
    setTrigger((previous) => {
      if (
        next?.anchor === previous?.anchor &&
        next?.query === previous?.query &&
        next?.kind === previous?.kind
      ) {
        return previous;
      }
      setMentionIndex(0);
      return next;
    });
  }, []);

  /**
   * Put the bar over the words it is about.
   *
   * A layout effect rather than an effect, and measured rather than derived:
   * the overlay lays the draft out glyph by glyph, so where a word ends up is
   * something only the DOM knows, and asking after the paint would show the
   * bar in last selection's place for a frame. It stays inside the pane's
   * inset, so a word at either edge does not push it off the glass.
   */
  useLayoutEffect(() => {
    if (!selection) {
      setBarLeft(null);
      return;
    }
    const box = shell.current?.getBoundingClientRect();
    const width = bar.current?.offsetWidth ?? 0;
    if (!box || !width) return;
    const half = width / 2;
    const min = PANEL_INSET_PX + half;
    const max = box.width - PANEL_INSET_PX - half;
    const rect = editor.current?.selectionRect();
    // With nothing measurable - a selection the overlay has not drawn yet -
    // the bar waits at the left edge rather than jumping to the middle.
    const centre = rect ? (rect.left + rect.right) / 2 - box.left : min;
    setBarLeft(max < min ? box.width / 2 : Math.min(Math.max(centre, min), max));
  }, [selection, draft]);

  /**
   * Carry out a formatting button.
   *
   * The editor does the work: it owns the markdown dialect and the caret, and
   * Ctrl+B already goes through the same two entry points. Deciding here what
   * `**` means would be a second dialect to keep honest.
   */
  const applyFormat = useCallback((action: FormatAction) => {
    if (action.kind === "mark") editor.current?.wrapSelection(action.before, action.after);
    else editor.current?.toggleList(action.list);
  }, []);

  /** Pull every image off a clipboard's `DataTransfer`, staging each. */
  const stageClipboardImages = useCallback(
    (clip: DataTransfer): boolean => {
      if (!onAttachFiles) return false;
      const found: File[] = [];
      const items = clip.items;
      if (items?.length) {
        for (const item of items) {
          if (item.kind === "file" && item.type.startsWith("image/")) {
            const file = item.getAsFile();
            if (file) found.push(file);
          }
        }
      }
      if (found.length === 0 && clip.files?.length) {
        for (const file of clip.files) if (file.type.startsWith("image/")) found.push(file);
      }
      if (found.length === 0) return false;
      onAttachFiles(found);
      return true;
    },
    [onAttachFiles],
  );

  /**
   * The one paste path WebKitGTK actually carries an image on.
   *
   * Linux's webview leaves `clipboardData` empty for a pasted image - the
   * async Clipboard API is the only route a screenshot or a copied photo
   * reaches this composer by, so a paste that the synchronous path found
   * nothing on always tries this before giving up.
   */
  const readClipboardImageAsync = useCallback(async () => {
    if (!onAttachFiles || !navigator.clipboard?.read) return;
    try {
      const items = await navigator.clipboard.read();
      const found: File[] = [];
      for (const item of items) {
        const type = item.types.find((candidate) => candidate.startsWith("image/"));
        if (!type) continue;
        const blob = await item.getType(type);
        found.push(new File([blob], "clipboard.png", { type }));
      }
      if (found.length > 0) onAttachFiles(found);
    } catch {
      // No permission, or nothing image-shaped on the clipboard - a normal
      // text paste falls through here just as often as a denied one does.
    }
  }, [onAttachFiles]);

  const handlePaste = useCallback(
    (event: React.ClipboardEvent<Element>) => {
      const clip = event.clipboardData;
      if (clip && stageClipboardImages(clip)) {
        event.preventDefault();
        return;
      }
      void readClipboardImageAsync();
    },
    [stageClipboardImages, readClipboardImageAsync],
  );

  const submit = () => {
    const text = draft.trim();
    // A reply with nothing typed is still a message: the quote is the content,
    // and the shell turns it into the markers that carry it.
    if (disabled || !sendable) return;

    // A slash line is an instruction to a plugin rather than a message: it is
    // parsed and dispatched, and nothing is said in the channel.
    const parsed = parseSlashLine(text, allSlash);
    if (parsed) {
      setDraft("");
      draftRef.current = "";
      resetTyping();
      if (parsed.errors.length > 0) {
        console.warn("[nebula] slash command rejected:", parsed.errors.join("; "));
        return;
      }
      void sendPluginInteraction(parsed.pluginName, parsed.kind, selectedChannel).catch((e) =>
        console.warn("[nebula] sendPluginInteraction failed:", e),
      );
      return;
    }

    setDraft("");
    draftRef.current = "";
    setTrigger(null);
    resetTyping();
    void onSend(composerHtml(text));
  };

  const dropping = dropActive;
  // The border lights up while there is something to send, which is also when
  // the panel has grown a row it did not have at rest.
  const sendable =
    (draft.trim().length > 0 || quotes.length > 0 || attachments.length > 0) &&
    shareOptionsReady(shareOptions, attachments);
  const uploading = uploads.some((upload) => upload.state === "uploading");

  const onKeyDownCapture = (event: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    // The shortcut the menu prints beside "Browse files…", taken here so the
    // editor's own Ctrl+U and Ctrl+B keep their letters.
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "o" && onAttach) {
      event.preventDefault();
      if (!attachBlocked) onAttach("any");
      return true;
    }
    // An open list owns the arrow keys and Enter. Only once nothing is open
    // does Enter go back to meaning send.
    if (slashOpen) {
      const action = handleSlashKey(event, { activeIndex: slashIndex, count: slashEntries.length });
      if (action) {
        event.preventDefault();
        if (action.kind === "move") setSlashIndex(action.index);
        else if (action.kind === "pick") pickSlash(slashEntries[action.index]);
        else setDraft("");
        return true;
      }
    }
    if (trigger && candidates.length > 0) {
      const action = handleMentionKey(event, { activeIndex: mentionIndex, count: candidates.length });
      if (action) {
        event.preventDefault();
        if (action.kind === "move") setMentionIndex(action.index);
        else if (action.kind === "pick") pickMention(candidates[action.index]);
        else setTrigger(null);
        return true;
      }
    }
    // Enter is the editor's own submit, so it is left alone here.
    return false;
  };

  /**
   * Whether the panel is lit.
   *
   * A disabled composer never lights: it is dimmed to 0.6 and cannot take a
   * keystroke, and an accent edge on it would promise one.
   */
  const lit = focused && !disabled;

  return (
    <Box
      ref={shell}
      sx={{
        flex: "none",
        position: "relative",
        width: "100%",
        maxWidth: PANEL_MAX_WIDTH,
        mx: "auto",
        boxSizing: "border-box",
        padding: PANEL_INSET,
      }}
    >
      {slashOpen && (
        <Box sx={POPUP}>
          <SlashCommandMenu
            entries={slashEntries}
            activeIndex={slashIndex}
            onPick={pickSlash}
            onActiveIndexChange={setSlashIndex}
          />
        </Box>
      )}
      {/* The mention list never coincides with a selection - a trigger is a
          caret in a word - but a slash line can be selected, and both want
          this spot. The list wins: it is what Enter is about to act on. */}
      {!slashOpen && selection && (
        <Box
          ref={bar}
          sx={{
            ...FORMAT_BAR,
            ...(barLeft === null
              ? { left: PANEL_INSET_PX }
              : { left: barLeft, transform: "translateX(-50%)" }),
          }}
        >
          <FormatBar
            onFormat={applyFormat}
            onEmoji={(event) => openPopover("emoji", event, EMOJI_POPOVER_WIDTH)}
          />
        </Box>
      )}
      {!slashOpen && trigger && candidates.length > 0 && (
        <Box sx={POPUP}>
          <MentionAutocomplete
            candidates={candidates}
            activeIndex={mentionIndex}
            onPick={pickMention}
            onActiveIndexChange={setMentionIndex}
          />
        </Box>
      )}

      <Box
        data-nebula-composer
        sx={(theme) => ({
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          borderRadius: PANEL_RADIUS,
          overflow: "hidden",
          backdropFilter: PANEL_BLUR,
          WebkitBackdropFilter: PANEL_BLUR,
          opacity: disabled ? 0.6 : 1,
          // Focus is stated on the panel, because the panel is the field. A
          // ring drawn around the words inside would be a second field boxed
          // within the first - the thing the canvas set out to remove - so the
          // edge that is already there turns accent instead, and throws a
          // hairline of soft accent just outside itself. Short enough to feel
          // like the click that caused it.
          transition: "background .14s ease, border-color .14s ease, box-shadow .14s ease",
          // The fill comes up a step with it. Held as a wash of accent over
          // the neutral one rather than swapped for a tinted token, so the
          // step is a lift in both schemes - the light scheme's tinted card is
          // *darker* than its wash, and lighting a surface by darkening it
          // reads as the panel going away.
          background: lit
            ? `linear-gradient(0deg,${alpha(theme.palette.nebula.accent, 0.09)},${alpha(
                theme.palette.nebula.accent,
                0.09,
              )}),${theme.palette.nebula.input}`
            : theme.palette.nebula.input,
          // Stronger than `accentLine`, which is the weight a *resting* accent
          // edge is drawn at - a selected card, a hovered row. This edge is
          // saying where the keyboard is pointed, and over a light scheme's
          // near-white wash a resting weight barely separates from the
          // hairline it replaces.
          border: `1px solid ${lit ? alpha(theme.palette.nebula.accent, 0.6) : theme.palette.nebula.line2}`,
          // Enough to lift the panel off the river behind it without the long
          // throw a floating menu gets - it is docked, not floating.
          boxShadow: lit
            ? `0 0 0 1px ${alpha(theme.palette.nebula.accent, 0.2)}, 0 6px 24px rgba(0,0,0,.12)`
            : "0 6px 24px rgba(0,0,0,.12)",
        })}
      >
        {/* Quotes are rows in one tray, not chips and not a tray each: two
            replies are two lines under a single hairline, so answering a
            second message grows the panel by a row rather than by a band. */}
        {quotes.length > 0 && (
          <Tray>
            {quotes.map((quote, index) => (
              <Fragment key={quote.message_id}>
                {index > 0 && <TrayRule />}
                <Stack direction="row" alignItems="center" gap="9px" sx={{ px: "4px", py: "6px" }}>
                  <Box
                    aria-hidden
                    sx={(theme) => ({ display: "flex", flex: "none", color: theme.palette.nebula.dim })}
                  >
                    <ReplyGlyph />
                  </Box>
                  <Typography
                    sx={(theme) => ({
                      flex: "none",
                      fontSize: 12,
                      fontWeight: 600,
                      color: theme.palette.nebula.accent,
                    })}
                  >
                    {quote.sender_name}
                  </Typography>
                  <Typography
                    sx={(theme) => ({
                      flex: 1,
                      minWidth: 0,
                      fontSize: 12,
                      color: theme.palette.nebula.muted,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    })}
                  >
                    {plainText(quote.body)}
                  </Typography>
                  <TrayClose
                    label={t("nebulaChat:composer.stopReplying", { name: quote.sender_name })}
                    onClick={() => quote.message_id && onRemoveQuote?.(quote.message_id)}
                  />
                </Stack>
              </Fragment>
            ))}
          </Tray>
        )}

        {/* Staged files are tiles on one scrolling line, with the choices
            about the batch folded away beside them - see AttachmentTray. */}
        {attachments.length > 0 && (
          <Tray>
            <AttachmentTray
              attachments={attachments}
              disabled={disabled}
              target={target}
              canSharePublic={canSharePublic}
              canExpire={canExpire}
              options={shareOptions}
              onOptionsChange={(next) => onShareOptionsChange?.(next)}
              onRemove={(id) => onRemoveAttachment?.(id)}
              onAddMore={() => onAttach?.("any")}
            />
          </Tray>
        )}

        {/* One tray for what is going up, and the bar is inside the row rather
            than along the panel's edge: a file has a name, a size and a share
            of itself already sent, and all three belong to the same line. */}
        {uploads.length > 0 && (
          <Tray>
            {uploads.map((upload, index) => (
              <Fragment key={upload.id}>
                {index > 0 && <TrayRule />}
                <UploadRow upload={upload} onCancel={() => onCancelUpload?.(upload.id)} />
              </Fragment>
            ))}
          </Tray>
        )}

        <Stack
          direction="row"
          alignItems="center"
          gap="9px"
          sx={{ minHeight: 54, flex: "none", px: "15px", py: "11px" }}
        >
          {/* The paperclip is the picker. Pressed, it opens the file dialog
              and whatever comes back lands in the tray - no panel between
              the click and the file. The other ways in sit behind the
              chevron beside it and behind a right-click on the clip. */}
          <BareButton
            label={attachBlocked ?? t("nebulaChat:composer.attachFiles")}
            disabled={disabled}
            muted={!!attachBlocked}
            buttonRef={attachButton}
            onClick={(event) => {
              if (attachBlocked) openPopover("notice", event, NOTICE_POPOVER_WIDTH);
              else onAttach?.("any");
            }}
            onContextMenu={(event) => {
              // Blocked stops files, not the menu: neither a poll nor a
              // document is a file, and a server with nothing to say about
              // file sharing still has both.
              if (hasAttachMenu) {
                event.preventDefault();
                setAttachMenu(event.currentTarget);
              }
            }}
          >
            <AttachIcon width={16} height={16} />
          </BareButton>
          {hasAttachMenu && (
            <BareButton
              label={t("nebulaChat:composer.moreWaysToAttach")}
              disabled={disabled}
              active={!!attachMenu}
              size={16}
              sx={{ height: 28, ml: "-6px", borderRadius: radius("sm") }}
              onClick={(event) => setAttachMenu(event.currentTarget)}
            >
              <ChevronDownIcon width={10} height={10} strokeWidth={2.2} />
            </BareButton>
          )}
          {/* A word, not a glyph: the canvas gives GIF a small chip of its own
              because there is no picture of "GIF" anyone reads faster. */}
          <Box
            component="button"
            type="button"
            aria-label={t("nebulaChat:composer.insertGif")}
            disabled={disabled}
            onClick={(event) => openPopover("gif", event, GIF_POPOVER_WIDTH)}
            sx={(theme) => ({
              all: "unset",
              cursor: "pointer",
              flex: "none",
              padding: "4px 8px",
              borderRadius: radius("sm"),
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.03em",
              // The one badge several skins invert outright - Midnight runs cyan
              // on a bottle-green chip, Mobel and Ply leave it as plain type.
              background: theme.palette.nebula.gifBg,
              color: theme.palette.nebula.gifText,
              "&:hover": { background: theme.palette.nebula.hover, color: theme.palette.nebula.text },
            })}
          >
            GIF
          </Box>

          <Menu
            anchorEl={attachMenu}
            open={!!attachMenu}
            onClose={() => setAttachMenu(null)}
            anchorOrigin={{ vertical: "top", horizontal: "left" }}
            transformOrigin={{ vertical: "bottom", horizontal: "left" }}
            slotProps={{ paper: { sx: { width: 226 } } }}
          >
            {!attachBlocked && (
              <MenuItem
                onClick={() => {
                  setAttachMenu(null);
                  onAttach?.("any");
                }}
              >
                <MenuGlyph>
                  <AttachIcon width={14} height={14} />
                </MenuGlyph>
                {t("nebulaChat:composer.browseFiles")}
                <MenuHint>{BROWSE_SHORTCUT}</MenuHint>
              </MenuItem>
            )}
            {!attachBlocked && (
              <MenuItem
                onClick={() => {
                  setAttachMenu(null);
                  onAttach?.("media");
                }}
              >
                <MenuGlyph>
                  <ImageIcon width={14} height={14} />
                </MenuGlyph>
                {t("nebulaChat:composer.photoOrVideo")}
              </MenuItem>
            )}
            {onCreatePoll && (
              <MenuItem
                onClick={() => {
                  setAttachMenu(null);
                  openPopoverFrom("poll", attachButton.current, POLL_POPOVER_WIDTH);
                }}
              >
                <MenuGlyph>
                  <PollIcon width={14} height={14} />
                </MenuGlyph>
                {t("nebulaChat:composer.createPoll")}
              </MenuItem>
            )}
            {onOpenLiveDoc && (
              <MenuItem
                onClick={() => {
                  setAttachMenu(null);
                  onOpenLiveDoc();
                }}
              >
                <MenuGlyph>
                  <FileTextIcon width={14} height={14} />
                </MenuGlyph>
                {t("nebulaChat:composer.newDocument")}
              </MenuItem>
            )}
            <Typography
              sx={(theme) => ({
                px: "10px",
                pt: "7px",
                pb: "4px",
                fontSize: 10.5,
                lineHeight: 1.4,
                color: theme.palette.nebula.dim,
              })}
            >
              {attachBlocked
                ? t("nebulaChat:composer.blockedNote", { reason: attachBlocked })
                : t("nebulaChat:composer.dragHint")}
            </Typography>
          </Menu>

          {/* The text shares the row with the tools rather than taking one of
              its own - the panel only grows for things that dock above it. */}
          {/*
           * The editor's own chrome is stripped here.
           *
           * `MarkdownInput` is Standard's composer field: its wrapper carries
           * a border, a glass fill, a radius and a 40px floor because there it
           * *is* the composer. Inside this panel that draws a second field
           * boxed within the first - the exact thing the canvas set out to
           * remove. The overlay and the textarea must keep identical padding
           * or the caret drifts off the text, so both are zeroed together.
           */}
          <Box
            // Focus and blur are taken here rather than on the textarea: they
            // are the DOM's bubbling pair, so the one listener covers the
            // field however deep the editor puts it.
            onFocus={() => setFocused(true)}
            // Leaving the editor puts the bar away. A textarea keeps its
            // selection through a blur, so without this the bar would hang
            // over a composer nobody is typing in. The bar's own buttons
            // refuse focus, so pressing one is not leaving.
            onBlur={() => {
              setFocused(false);
              setSelection(null);
            }}
            sx={(theme) => ({
              flex: 1,
              minWidth: 0,
              // The widget colours itself from Standard's custom properties,
              // which only exist once Standard's appearance has been applied.
              // Feeding it Nebula's palette makes it right here regardless -
              // without them the placeholder inherits and comes out white.
              "--color-text-primary": theme.palette.nebula.text,
              // The placeholder comes up with the panel. Dim is the colour of
              // a line nobody is writing; once the caret is in it, the words
              // are about to be replaced and are worth reading first.
              "--color-text-muted": lit ? theme.palette.nebula.muted : theme.palette.nebula.dim,
              "--color-accent": theme.palette.nebula.accent,
              // The editor draws its own caret, in the text's colour by
              // default. In a panel that lights accent the caret is the
              // smallest part of the same statement, so it lights too.
              "--color-caret": theme.palette.nebula.accent,
              // And so does the selection. The browser's own highlight is a
              // flat slab of system blue that owes nothing to the scheme; the
              // canvas marks the run the way it marks a code span instead - a
              // wash of accent inside a hairline of it, rounded. The edge is
              // what keeps it legible over glass, where a fill alone at this
              // alpha is barely a change of shade.
              "--color-selection": theme.palette.nebula.accentSoft,
              "--selection-ring": `0 0 0 1px ${theme.palette.nebula.accentLine}`,
              "--selection-radius": "3px",
              "& > div": {
                minHeight: 22,
                maxHeight: 120,
                background: "transparent",
                border: "none",
                borderRadius: 0,
              },
              "& > div > div, & > div > textarea": { padding: 0, fontSize: 14, lineHeight: 1.4 },
              // The panel is the field, so the field inside it must not draw
              // one of its own. Standard's global sheet writes
              // `textarea:focus-visible` plainly, which outranks the editor's
              // own `outline: none` - and the wrapper clips it into a boxed
              // ring around the words. Said here at a weight that wins.
              "& > div > textarea:focus, & > div > textarea:focus-visible": {
                outline: "none",
                boxShadow: "none",
              },
            })}
          >
            <MarkdownInput
              apiRef={editor}
              value={draft}
              disabled={disabled}
              placeholder={`Message ${target}`}
              ariaLabel={`Message ${target}`}
              keepPlaceholderOnFocus
              onChange={(next) => {
                draftRef.current = next;
                setDraft(next);
                notifyTyping();
              }}
              onSubmit={submit}
              onSelectionChange={(start, end) => updateTrigger(draftRef.current, start, end)}
              onKeyDownCapture={onKeyDownCapture}
              onPaste={handlePaste}
              mentionResolver={mentionName}
            />
          </Box>

          <Tooltip
            title={uploading ? t("nebulaChat:composer.waitingForUpload") : t("chat:pendingAttachments.send")}
          >
            <span>
              <IconButton
                aria-label={t("settings:shortcuts.builtinSendMessage")}
                disabled={disabled || !sendable || uploading}
                onClick={submit}
                sx={(theme) => ({
                  flex: "none",
                  width: 32,
                  height: 32,
                  borderRadius: "999px",
                  background: theme.palette.nebula.accent,
                  color: theme.palette.nebula.onAccent,
                  // The one lit element on the panel, and the canvas lights it
                  // properly: a disc that throws its own accent underneath it.
                  boxShadow: `0 4px 14px ${theme.palette.nebula.accent}66`,
                  "&:hover": { background: theme.palette.nebula.accent, filter: "brightness(1.08)" },
                  "&.Mui-disabled": {
                    background: theme.palette.nebula.card2,
                    color: theme.palette.nebula.dim,
                    boxShadow: "none",
                  },
                })}
              >
                <SendIcon width={14} height={14} />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      </Box>

      {dropping && (
        <Box
          sx={(theme) => ({
            position: "absolute",
            inset: "10px",
            display: "grid",
            placeItems: "center",
            gap: "8px",
            borderRadius: PANEL_RADIUS,
            ...glassChrome(theme),
            backdropFilter: PANEL_BLUR,
            WebkitBackdropFilter: PANEL_BLUR,
            border: `1px dashed ${theme.palette.nebula.accentLine}`,
            zIndex: 25,
          })}
        >
          <Stack alignItems="center" gap="6px">
            <Box sx={(theme) => ({ display: "flex", color: theme.palette.nebula.accent })}>
              <UploadIcon width={20} height={20} />
            </Box>
            <Typography sx={{ fontSize: 14, fontWeight: 600 }}>
              {t("nebulaChat:composer.dropFiles")}
            </Typography>
          </Stack>
        </Box>
      )}

      {popover && (
        <>
          <PopoverScrim onClose={() => setPopover(null)} />
          {popover.kind === "poll" && onCreatePoll && (
            <PollPopover
              left={popover.left}
              onSubmit={(question, options, multiple) => {
                setPopover(null);
                onCreatePoll(question, options, multiple);
              }}
              onClose={() => setPopover(null)}
            />
          )}
          {popover.kind === "notice" && attachBlocked && (
            <PopoverPanel
              width={NOTICE_POPOVER_WIDTH}
              left={popover.left}
              title={t("nebulaChat:composer.files")}
              onClose={() => setPopover(null)}
            >
              <Typography sx={{ px: "14px", py: "14px", fontSize: 13, lineHeight: 1.5 }}>
                {attachBlocked}.
              </Typography>
            </PopoverPanel>
          )}
          {popover.kind === "emoji" ? (
            <EmojiPopover
              left={popover.left}
              onSelect={(glyph) => {
                setPopover(null);
                insertAtCaret(glyph);
              }}
              onClose={() => setPopover(null)}
            />
          ) : popover.kind === "gif" ? (
            <GifPopover
              left={popover.left}
              onSelect={(url) => {
                setPopover(null);
                void onSend(`<img src="${url}" alt="GIF">`);
              }}
              onClose={() => setPopover(null)}
            />
          ) : null}
        </>
      )}
    </Box>
  );
}

/**
 * A strip docked above the input row.
 *
 * Everything the composer is holding but has not sent yet - replies, staged
 * files, uploads in flight - is drawn in one of these. They stack, and each
 * closes with the same hairline, so the panel reads as one surface growing
 * upward rather than as a pile of cards balanced on the field.
 */
function Tray({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <Box
      data-nebula-tray
      sx={(theme) => ({
        flex: "none",
        px: "11px",
        py: "5px",
        borderBottom: `1px solid ${theme.palette.nebula.washLine}`,
      })}
    >
      {children}
    </Box>
  );
}

/**
 * The line between two rows of the same tray.
 *
 * Lighter than the tray's own edge and inset from it: two replies are one
 * thing the message is doing, and a full-weight rule between them would read
 * as two trays that happen to be touching.
 */
function TrayRule() {
  return (
    <Box
      aria-hidden
      data-nebula-tray-rule
      sx={(theme) => ({ height: "1px", mx: "4px", background: theme.palette.nebula.line })}
    />
  );
}

/** The small cross that takes a tray row away, held to the row's right edge. */
function TrayClose({ label, onClick }: Readonly<{ label: string; onClick: () => void }>) {
  return (
    <BareButton label={label} onClick={onClick} size={20} sx={{ ml: "auto", borderRadius: radius("sm") }}>
      <CloseIcon width={10} height={10} />
    </BareButton>
  );
}

/**
 * One file on its way to the server.
 *
 * The bar is three pixels inside the row rather than a hairline along the
 * panel's edge, which is what lets a second upload have one of its own - and
 * what keeps the progress attached to the name it belongs to.
 */
function UploadRow({ upload, onCancel }: Readonly<{ upload: UploadPlaceholder; onCancel: () => void }>) {
  const { t } = useTranslation(COMPOSER_NS);
  const failed = upload.state === "error";
  // A failure stops the bar where it stopped. Filling it would say the file
  // got there, which is the opposite of what the row underneath says.
  const done = upload.progress ?? 0;

  return (
    <Stack direction="row" alignItems="center" gap="10px" sx={{ px: "4px", py: "6px" }}>
      <Box
        aria-hidden
        sx={(theme) => ({
          width: 40,
          height: 40,
          flex: "none",
          display: "grid",
          placeItems: "center",
          overflow: "hidden",
          borderRadius: radius("md"),
          border: `1px solid ${theme.palette.nebula.line}`,
          background: theme.palette.nebula.tile,
          fontFamily: NEBULA_MONO,
          fontSize: 9,
          fontWeight: 600,
          color: theme.palette.nebula.muted,
        })}
      >
        {upload.previewUrl ? (
          <Box
            component="img"
            src={upload.previewUrl}
            alt=""
            sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        ) : (
          extension(upload.filename)
        )}
      </Box>
      <Stack sx={{ flex: 1, minWidth: 0 }}>
        <Typography
          sx={{
            fontSize: 11.5,
            fontWeight: 500,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {upload.filename}
        </Typography>
        <Typography
          sx={(theme) => ({
            fontSize: 10,
            mt: "2px",
            fontVariantNumeric: "tabular-nums",
            color: failed ? theme.palette.nebula.bad : theme.palette.nebula.dim,
          })}
        >
          {failed ? (upload.errorMessage ?? t("chat:upload.failed")) : uploadProgressLine(t, upload)}
        </Typography>
        <Box
          aria-hidden
          sx={(theme) => ({
            height: 3,
            mt: "5px",
            borderRadius: "2px",
            overflow: "hidden",
            background: theme.palette.nebula.card2,
          })}
        >
          <Box
            sx={(theme) => ({
              height: "100%",
              width: `${done}%`,
              borderRadius: "2px",
              background: failed ? theme.palette.nebula.bad : theme.palette.nebula.accent,
            })}
          />
        </Box>
      </Stack>
      <TrayClose
        label={t("nebulaChat:composer.cancelUpload", { filename: upload.filename })}
        onClick={onCancel}
      />
    </Stack>
  );
}

/**
 * What an upload has to say about itself, in the order it becomes knowable.
 *
 * The size is there from the start, the percentage from the first event, the
 * estimate only once there is a rate to estimate from - and each is simply
 * left out until it is true, rather than stood in for by a zero.
 */
function uploadProgressLine(t: ComposerT, upload: UploadPlaceholder): string {
  return [
    upload.totalBytes === undefined ? null : formatBytes(upload.totalBytes),
    t("nebulaChat:composer.percent", { value: upload.progress ?? 0 }),
    upload.etaSeconds === undefined
      ? null
      : t("nebulaChat:composer.etaSeconds", { seconds: upload.etaSeconds }),
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Where a popover's left edge goes, in pixels from the shell's left edge.
 *
 * Under the button that opened it, clamped so the panel stays inside the
 * pane; a missing button puts it at the pane's edge.
 */
function popoverLeft(shell: HTMLElement | null, button: HTMLElement | null, width: number): number {
  const anchor = button?.getBoundingClientRect();
  const box = shell?.getBoundingClientRect();
  const room = (box?.width ?? width) - width - 20;
  return Math.max(0, Math.min((anchor?.left ?? 0) - (box?.left ?? 0), room));
}

/**
 * A tool on the composer's second row.
 *
 * Bare on purpose: the panel is the only container the design allows, so an
 * icon gets no chip of its own. What separates them is space and the hairline
 * beside them, not a box each.
 */
function BareButton({
  label,
  onClick,
  onContextMenu,
  disabled = false,
  muted = false,
  active = false,
  size = 28,
  sx,
  buttonRef,
  children,
}: Readonly<{
  label: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onContextMenu?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  /** Drawn as unavailable, but still pressable so it can say why. */
  muted?: boolean;
  /** Holding something open - the fill stays while it is. */
  active?: boolean;
  size?: number;
  sx?: SxProps<Theme>;
  /** The element, for a popover that has to find the button unpressed. */
  buttonRef?: React.Ref<HTMLButtonElement>;
  children: React.ReactNode;
}>) {
  return (
    <Tooltip title={label}>
      <Box
        ref={buttonRef}
        component="button"
        type="button"
        aria-label={label}
        aria-expanded={active || undefined}
        disabled={disabled}
        onClick={onClick}
        onContextMenu={onContextMenu}
        sx={[
          (theme: Theme) => ({
            all: "unset",
            cursor: disabled ? "default" : "pointer",
            flex: "none",
            width: size,
            height: size,
            display: "grid",
            placeItems: "center",
            borderRadius: radius("md"),
            background: active ? theme.palette.nebula.card2 : "transparent",
            color: active ? theme.palette.nebula.text : theme.palette.nebula.muted,
            opacity: disabled || muted ? 0.45 : 1,
            "&:hover": disabled
              ? undefined
              : { background: theme.palette.nebula.hover, color: theme.palette.nebula.text },
          }),
          ...(Array.isArray(sx) ? sx : [sx]),
        ]}
      >
        {children}
      </Box>
    </Tooltip>
  );
}

/** What the menu prints beside "Browse files…". */
const BROWSE_SHORTCUT = navigator.platform.startsWith("Mac") ? "⌘O" : "Ctrl+O";

/** The shortcut a menu row ends with, small and pushed to the edge. */
function MenuHint({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <Box
      component="span"
      aria-hidden
      sx={(theme) => ({
        ml: "auto",
        pl: "12px",
        fontSize: 10,
        fontVariantNumeric: "tabular-nums",
        color: theme.palette.nebula.dim,
      })}
    >
      {children}
    </Box>
  );
}

/** The muted glyph a menu row leads with, as the canvas draws its menus. */
function MenuGlyph({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <Box aria-hidden sx={(theme) => ({ display: "flex", flex: "none", color: theme.palette.nebula.muted })}>
      {children}
    </Box>
  );
}

/** The reply arrow that opens a quote row, drawn as the canvas draws it. */
function ReplyGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10a6 6 0 016 6v3" />
    </svg>
  );
}
