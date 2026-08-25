import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Stack } from "../primitives";
import { Box, Dialog, DialogContent, IconButton, Tooltip } from "@mui/material";
import { useTypingIndicator } from "@core/features/chat/typing/useTypingIndicator";
import { sendPluginInteraction, useAppStore } from "@core/store";
import { parseMentionTrigger, type MentionTrigger } from "@core/utils/mentions";
import { collectSlashCommands, filterSlashCommands } from "@core/plugins/tier1/manifest";
import { extractSlashQuery, parseSlashLine } from "@core/plugins/tier1/slashParser";
import { EmojiPlusIcon, PlusIcon, PollIcon, SendIcon } from "@ui/icons";
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
import { composerHtml } from "../../selectors";
import { glassChrome } from "../../theme";
import { radius } from "../../tokens";

interface ComposerProps {
  /** Placeholder target, e.g. "#Gaming" or "@Lorelando". */
  target: string;
  disabled?: boolean;
  onSend: (html: string) => void | Promise<void>;
  onAttach?: () => void;
  /** Open the poll composer. Absent in DMs, which have no channel to poll. */
  onCreatePoll?: () => void;
}

const POPUP = {
  position: "absolute",
  bottom: "100%",
  left: "26px",
  right: "26px",
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
}: Readonly<ComposerProps>) {
  const [draft, setDraft] = useState("");
  const [gifOpen, setGifOpen] = useState(false);
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
    if (!text || disabled) return;

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
    <Box sx={{ flex: "none", px: "26px", pt: "12px", pb: "24px", position: "relative" }}>
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

      <Stack
        direction="row"
        // Centred, not bottom-aligned: the bar is one line tall at rest, and a
        // bottom-aligned row parks a single line of text against the pill's
        // lower edge instead of on its centre line.
        alignItems="center"
        gap={1.125}
        sx={(theme) => ({
          minHeight: 50,
          px: "15px",
          py: "8px",
          borderRadius: "999px",
          ...glassChrome(theme),
          border: `1px solid ${theme.palette.nebula.line2}`,
          boxShadow: "0 6px 24px rgba(0,0,0,.12)",
          opacity: disabled ? 0.6 : 1,
        })}
      >
        {/* Rendered only when wired: a permanently disabled button is a promise
            the composer cannot keep. */}
        {onAttach && (
          <Tooltip title="Attach a file">
            <IconButton
              aria-label="Attach a file"
              disabled={disabled}
              onClick={onAttach}
              sx={{ width: 28, height: 28 }}
            >
              <PlusIcon width={16} height={16} />
            </IconButton>
          </Tooltip>
        )}
        {onCreatePoll && (
          <Tooltip title="Poll">
            <IconButton
              aria-label="Create a poll"
              disabled={disabled}
              onClick={onCreatePoll}
              sx={{ width: 28, height: 28 }}
            >
              <PollIcon width={16} height={16} />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title="Emoji">
          <IconButton
            aria-label="Insert emoji"
            disabled={disabled}
            onClick={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              setEmoji({ x: box.left, y: box.top });
            }}
            sx={{ width: 28, height: 28 }}
          >
            <EmojiPlusIcon width={16} height={16} />
          </IconButton>
        </Tooltip>
        <Box
          component="button"
          onClick={() => setGifOpen(true)}
          sx={(theme) => ({
            all: "unset",
            cursor: "pointer",
            px: "8px",
            py: "4px",
            borderRadius: radius("sm"),
            fontSize: 10,
            fontWeight: 500,
            color: theme.palette.nebula.muted,
            background: theme.palette.nebula.card2,
            "&:hover": { background: theme.palette.nebula.hover },
          })}
        >
          GIF
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
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
        <Tooltip title="Send">
          <span>
            <IconButton
              aria-label="Send message"
              disabled={disabled || !draft.trim()}
              onClick={submit}
              sx={(theme) => ({
                flex: "none",
                width: 32,
                height: 32,
                borderRadius: "50%",
                color: "#fff",
                background: theme.palette.nebula.accent,
                boxShadow: `0 4px 14px ${theme.palette.nebula.accent}66`,
                "&:hover": { background: theme.palette.nebula.accent, filter: "brightness(1.08)" },
                "&.Mui-disabled": { background: theme.palette.nebula.card2, color: theme.palette.nebula.dim },
              })}
            >
              <SendIcon width={13} height={13} />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

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

      <Dialog open={gifOpen} onClose={() => setGifOpen(false)} maxWidth="sm" fullWidth>
        <DialogContent sx={{ p: 1.5 }}>
          <KlipyGifBrowser
            onSelect={(url) => {
              setGifOpen(false);
              void onSend(`<img src="${url}" alt="GIF">`);
            }}
          />
        </DialogContent>
      </Dialog>
    </Box>
  );
}
