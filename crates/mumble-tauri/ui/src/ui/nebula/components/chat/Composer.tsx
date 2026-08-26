import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Stack } from "../primitives";
import { Box, IconButton, Tooltip, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import { useTypingIndicator } from "@core/features/chat/typing/useTypingIndicator";
import { sendPluginInteraction, useAppStore } from "@core/store";
import { parseMentionTrigger, type MentionTrigger } from "@core/utils/mentions";
import { collectSlashCommands, filterSlashCommands } from "@core/plugins/tier1/manifest";
import { extractSlashQuery, parseSlashLine } from "@core/plugins/tier1/slashParser";
import { ArrowUpIcon, AttachIcon, CloseIcon, PollIcon, SmileIcon, UploadIcon } from "@ui/icons";
import { KlipyGifBrowser } from "@standard/pages/settings/KlipyGifBrowser";
import EmojiPicker from "@standard/components/elements/EmojiPicker";
import MentionAutocomplete, {
  candidateInsertText,
  handleMentionKey,
  type MentionCandidate,
} from "@standard/components/chat/mention/MentionAutocomplete";
import { useMentionCandidates } from "@standard/components/chat/mention/useMentionCandidates";
import SlashCommandMenu, { handleSlashKey } from "@standard/components/plugin/SlashCommandMenu";
import MarkdownInput, { type MarkdownInputApi } from "@standard/components/chat/markdown/MarkdownInput";
import type { ChatMessage } from "@core/types";
import type { UploadPlaceholder } from "@core/features/chat/useFileUpload";
import { composerHtml, plainText } from "../../selectors";
import { glassChrome } from "../../theme";

interface ComposerProps {
  /** Placeholder target, e.g. "#Gaming" or "@Lorelando". */
  target: string;
  disabled?: boolean;
  onSend: (html: string) => void | Promise<void>;
  onAttach?: () => void;
  /** Open the poll composer. Absent in DMs, which have no channel to poll. */
  onCreatePoll?: () => void;
  /** Messages this one is replying to, drawn above the text. */
  quotes?: readonly ChatMessage[];
  onRemoveQuote?: (messageId: string) => void;
  /** Uploads in flight, drawn as tiles above the text. */
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
const PANEL_INSET = "10px";
/**
 * Where the composer stops growing.
 *
 * About a 16:9 pane. Past that an ultrawide window would stretch one line of
 * text across a metre of glass; below it nothing changes, so a laptop keeps
 * the inset edge to edge.
 */
const PANEL_MAX_WIDTH = 1360;
/**
 * Popovers keep their own width.
 *
 * They are anchored to the icon that opened them and never stretched to the
 * pane - on an ultrawide window a GIF grid spanning the whole footer is
 * unusable, and the cap is what stops it.
 */
const GIF_POPOVER_WIDTH = 400;
const PANEL_RADIUS = "16px";
const TILE_RADIUS = "14px";
const PANEL_BLUR = "blur(32px) saturate(160%)";

const POPUP = {
  position: "absolute",
  bottom: "100%",
  left: PANEL_INSET,
  right: PANEL_INSET,
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
export function Composer({
  target,
  disabled = false,
  onSend,
  onAttach,
  onCreatePoll,
  quotes = [],
  onRemoveQuote,
  uploads = [],
  onCancelUpload,
  dropActive = false,
}: Readonly<ComposerProps>) {
  const [draft, setDraft] = useState("");
  const [gifOpen, setGifOpen] = useState(false);
  /** Left offset of the GIF button within the composer, so the panel hangs off it. */
  const [gifLeft, setGifLeft] = useState(0);
  const shell = useRef<HTMLDivElement>(null);
  const [emoji, setEmoji] = useState<{ x: number; y: number } | null>(null);
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
  const sendable = draft.trim().length > 0 || quotes.length > 0;
  const uploading = uploads.some((upload) => upload.state === "uploading");

  const onKeyDownCapture = (event: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
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
        sx={(theme) => ({
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          borderRadius: PANEL_RADIUS,
          overflow: "hidden",
          background: theme.palette.nebula.wash,
          backdropFilter: PANEL_BLUR,
          WebkitBackdropFilter: PANEL_BLUR,
          border: `1px solid ${theme.palette.nebula.washLine}`,
          opacity: disabled ? 0.6 : 1,
        })}
      >
        {/* Quotes are rows, not chips: two replies are two rows, and the panel
            grows upward from the input rather than wrapping a cluster of
            little cards above it. */}
        {quotes.map((quote) => (
          <Stack
            key={quote.message_id}
            direction="row"
            alignItems="center"
            gap="12px"
            sx={(theme) => ({
              height: 40,
              flex: "none",
              px: "14px",
              borderBottom: `1px solid ${theme.palette.nebula.washLine}`,
            })}
          >
            <Box aria-hidden sx={(theme) => ({ display: "flex", color: theme.palette.nebula.dim })}>
              <ReplyGlyph />
            </Box>
            <Typography
              sx={(theme) => ({ fontSize: 12, fontWeight: 600, color: theme.palette.nebula.accent })}
            >
              {quote.sender_name}
            </Typography>
            <Typography
              sx={(theme) => ({
                flex: 1,
                minWidth: 0,
                fontSize: 13,
                color: theme.palette.nebula.muted,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              })}
            >
              {plainText(quote.body)}
            </Typography>
            <BareButton
              label={`Stop replying to ${quote.sender_name}`}
              onClick={() => quote.message_id && onRemoveQuote?.(quote.message_id)}
              size={16}
            >
              <CloseIcon width={13} height={13} />
            </BareButton>
          </Stack>
        ))}

        {/* One tray for files, and the progress is the hairline under it -
            nothing new appears while a file is going up. */}
        {uploads.map((upload) => (
          <Stack
            key={upload.id}
            direction="row"
            alignItems="center"
            gap="10px"
            sx={(theme) => ({
              position: "relative",
              height: 72,
              flex: "none",
              px: "14px",
              borderBottom: `1px solid ${theme.palette.nebula.washLine}`,
            })}
          >
            <Box
              aria-hidden
              sx={(theme) => ({
                width: 52,
                height: 52,
                flex: "none",
                display: "grid",
                placeItems: "center",
                borderRadius: TILE_RADIUS,
                background: theme.palette.nebula.card2,
                fontFamily: "ui-monospace,Menlo,monospace",
                fontSize: 9,
                color: theme.palette.nebula.muted,
              })}
            >
              {extension(upload.filename)}
            </Box>
            <Stack gap="3px" sx={{ flex: 1, minWidth: 0 }}>
              <Typography
                sx={{
                  fontSize: 13,
                  fontWeight: 500,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {upload.filename}
              </Typography>
              <Typography sx={(theme) => ({ fontSize: 11, color: theme.palette.nebula.muted })}>
                {upload.state === "error"
                  ? (upload.errorMessage ?? "Upload failed")
                  : `${upload.progress ?? 0}% · sending`}
              </Typography>
            </Stack>
            <Box
              component="button"
              type="button"
              aria-label={`Cancel upload of ${upload.filename}`}
              onClick={() => onCancelUpload?.(upload.id)}
              sx={(theme) => ({
                all: "unset",
                cursor: "pointer",
                fontSize: 12,
                color: theme.palette.nebula.muted,
                "&:hover": { color: theme.palette.nebula.text },
              })}
            >
              Cancel
            </Box>
            {/* The divider fills as it goes, so the row gains no second bar. */}
            <Box aria-hidden sx={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "1px" }}>
              <Box
                sx={(theme) => ({
                  height: "1px",
                  width: `${upload.state === "error" ? 100 : (upload.progress ?? 0)}%`,
                  background:
                    upload.state === "error" ? theme.palette.nebula.bad : theme.palette.nebula.accent,
                })}
              />
            </Box>
          </Stack>
        ))}

        <Stack
          direction="row"
          alignItems="center"
          gap="16px"
          sx={{ minHeight: 52, flex: "none", px: "14px", py: "8px" }}
        >
          {onAttach && (
            <BareButton label="Attach a file" onClick={onAttach} disabled={disabled}>
              <AttachIcon width={18} height={18} />
            </BareButton>
          )}
          <BareButton
            label="Insert emoji"
            disabled={disabled}
            onClick={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              setEmoji({ x: box.left, y: box.top });
            }}
          >
            <SmileIcon width={18} height={18} />
          </BareButton>

          <HairDivider />

          <Box
            component="button"
            type="button"
            aria-label="Insert a GIF"
            disabled={disabled}
            onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
              const anchor = event.currentTarget.getBoundingClientRect();
              const box = shell.current?.getBoundingClientRect();
              // Clamped so a button near the right edge does not push the
              // panel off the pane.
              const width = box?.width ?? GIF_POPOVER_WIDTH;
              setGifLeft(Math.max(0, Math.min(anchor.left - (box?.left ?? 0), width - GIF_POPOVER_WIDTH)));
              setGifOpen(true);
            }}
            sx={(theme) => ({
              all: "unset",
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.07em",
              color: theme.palette.nebula.muted,
              "&:hover": { color: theme.palette.nebula.text },
            })}
          >
            GIF
          </Box>
          {onCreatePoll && (
            <BareButton label="Create a poll" onClick={onCreatePoll} disabled={disabled}>
              <PollIcon width={18} height={18} />
            </BareButton>
          )}

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
            sx={(theme) => ({
              flex: 1,
              minWidth: 0,
              // The widget colours itself from Standard's custom properties,
              // which only exist once Standard's appearance has been applied.
              // Feeding it Nebula's palette makes it right here regardless -
              // without them the placeholder inherits and comes out white.
              "--color-text-primary": theme.palette.nebula.text,
              "--color-text-muted": theme.palette.nebula.dim,
              "--color-accent": theme.palette.nebula.accent,
              "& > div": {
                minHeight: 22,
                maxHeight: 120,
                background: "transparent",
                border: "none",
                borderRadius: 0,
              },
              "& > div > div, & > div > textarea": { padding: 0, fontSize: 14, lineHeight: 1.4 },
            })}
          >
            <MarkdownInput
              apiRef={editor}
              value={draft}
              disabled={disabled}
              placeholder={`Message ${target}`}
              ariaLabel={`Message ${target}`}
              onChange={(next) => {
                draftRef.current = next;
                setDraft(next);
                notifyTyping();
              }}
              onSubmit={submit}
              onSelectionChange={(start, end) => updateTrigger(draftRef.current, start, end)}
              onKeyDownCapture={onKeyDownCapture}
              mentionResolver={mentionName}
            />
          </Box>

          <Tooltip title={uploading ? "Waiting for the upload to finish" : "Send"}>
            <span>
              <IconButton
                aria-label="Send message"
                disabled={disabled || !sendable || uploading}
                onClick={submit}
                sx={(theme) => ({
                  flex: "none",
                  width: 30,
                  height: 30,
                  borderRadius: "999px",
                  background: theme.palette.nebula.accent,
                  color: theme.palette.nebula.onAccent,
                  "&:hover": { background: theme.palette.nebula.accent, filter: "brightness(1.08)" },
                  "&.Mui-disabled": {
                    background: theme.palette.nebula.card2,
                    color: theme.palette.nebula.dim,
                  },
                })}
              >
                <ArrowUpIcon width={15} height={15} />
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
            <Typography sx={{ fontSize: 14, fontWeight: 600 }}>Drop files to send</Typography>
          </Stack>
        </Box>
      )}

      {emoji && (
        <EmojiPicker
          anchorX={emoji.x}
          anchorY={emoji.y}
          onSelect={(glyph) => {
            setEmoji(null);
            insertAtCaret(glyph);
          }}
          onClose={() => setEmoji(null)}
        />
      )}

      {/* A popover on the composer's own inset, not a centred modal with a
          scrim over the conversation. */}
      {gifOpen && (
        <>
          <Box
            onClick={() => setGifOpen(false)}
            sx={{ position: "fixed", inset: 0, zIndex: 24 }}
            aria-hidden
          />
          <Box
            sx={(theme) => ({
              position: "absolute",
              bottom: "100%",
              left: gifLeft + 10,
              width: GIF_POPOVER_WIDTH,
              maxWidth: "calc(100% - 20px)",
              zIndex: 25,
              borderRadius: PANEL_RADIUS,
              overflow: "hidden",
              background: theme.palette.nebula.wash,
              backdropFilter: PANEL_BLUR,
              WebkitBackdropFilter: PANEL_BLUR,
              border: `1px solid ${theme.palette.nebula.washLine}`,
            })}
          >
            <KlipyGifBrowser
              onSelect={(url) => {
                setGifOpen(false);
                void onSend(`<img src="${url}" alt="GIF">`);
              }}
            />
          </Box>
        </>
      )}
    </Box>
  );
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
  disabled = false,
  size = 22,
  sx,
  children,
}: Readonly<{
  label: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  size?: number;
  sx?: SxProps<Theme>;
  children: React.ReactNode;
}>) {
  return (
    <Tooltip title={label}>
      <Box
        component="button"
        type="button"
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
        sx={[
          (theme: Theme) => ({
            all: "unset",
            cursor: disabled ? "default" : "pointer",
            width: size,
            height: size,
            display: "grid",
            placeItems: "center",
            color: theme.palette.nebula.muted,
            opacity: disabled ? 0.5 : 1,
            "&:hover": { color: disabled ? undefined : theme.palette.nebula.text },
          }),
          ...(Array.isArray(sx) ? sx : [sx]),
        ]}
      >
        {children}
      </Box>
    </Tooltip>
  );
}

/** The upright hairline that groups the tool row, rather than a chip edge. */
function HairDivider() {
  return (
    <Box aria-hidden sx={(theme) => ({ width: "1px", height: 18, background: theme.palette.nebula.line2 })} />
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

/** The file's kind, for the tray's type badge. */
function extension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1
    ? "FILE"
    : filename
        .slice(dot + 1)
        .toUpperCase()
        .slice(0, 4);
}
