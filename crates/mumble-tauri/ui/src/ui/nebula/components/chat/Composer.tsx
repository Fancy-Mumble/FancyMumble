import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Stack } from "../primitives";
import { Box, Dialog, DialogContent, IconButton, InputBase, Tooltip } from "@mui/material";
import { useTypingIndicator } from "@core/features/chat/typing/useTypingIndicator";
import { sendPluginInteraction, useAppStore } from "@core/store";
import { parseMentionTrigger, type MentionTrigger } from "@core/utils/mentions";
import { collectSlashCommands, filterSlashCommands } from "@core/plugins/tier1/manifest";
import { extractSlashQuery, parseSlashLine } from "@core/plugins/tier1/slashParser";
import { EmojiPlusIcon, PlusIcon, SendIcon } from "@ui/icons";
import { KlipyGifBrowser } from "@standard/pages/settings/KlipyGifBrowser";
import EmojiPicker from "@standard/components/elements/EmojiPicker";
import MentionAutocomplete, {
  candidateInsertText,
  handleMentionKey,
  type MentionCandidate,
} from "@standard/components/chat/mention/MentionAutocomplete";
import { useMentionCandidates } from "@standard/components/chat/mention/useMentionCandidates";
import SlashCommandMenu, { handleSlashKey } from "@standard/components/plugin/SlashCommandMenu";
import { composerHtml } from "../../selectors";
import { glassChrome } from "../../theme";
import { radius } from "../../tokens";

interface ComposerProps {
  /** Placeholder target, e.g. "#Gaming" or "@Lorelando". */
  target: string;
  disabled?: boolean;
  onSend: (html: string) => void | Promise<void>;
  onAttach?: () => void;
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
 * Three things can be open over it while typing - the mention list, the slash
 * command list, the emoji grid - and all three are pickers, so all three are
 * Standard's rather than redrawn here. What is Nebula's is the pill, and the
 * arithmetic of putting a chosen thing into a plain textarea: the draft is a
 * string and the caret is an offset into it, so inserting is a splice plus a
 * setSelectionRange rather than an editor command.
 */
export function Composer({ target, disabled = false, onSend, onAttach }: Readonly<ComposerProps>) {
  const [draft, setDraft] = useState("");
  const [gifOpen, setGifOpen] = useState(false);
  const [emoji, setEmoji] = useState<{ x: number; y: number } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { notifyTyping, resetTyping } = useTypingIndicator();

  const selectedChannel = useAppStore((state) => state.selectedChannel);
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
    setDraft((previous) => previous.slice(0, from) + text + previous.slice(to));
    const caret = from + text.length;
    // Placed after the commit rather than inside it: the value React is about
    // to render is not in the textarea yet, so a caret set now would be moved
    // straight back to the end by that render.
    requestAnimationFrame(() => {
      const node = inputRef.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(caret, caret);
    });
  }, []);

  const insertAtCaret = useCallback(
    (text: string) => {
      const node = inputRef.current;
      const from = node?.selectionStart ?? draft.length;
      const to = node?.selectionEnd ?? from;
      replaceRange(from, to, text);
    },
    [draft.length, replaceRange],
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
      setDraft(draft.slice(0, leading) + "/" + entry.command.name + " ");
      setSlashIndex(0);
    },
    [draft],
  );

  /** Re-read the mention trigger from wherever the caret has ended up. */
  const syncTrigger = useCallback(() => {
    const node = inputRef.current;
    if (!node) return;
    if (node.selectionStart !== node.selectionEnd) {
      if (trigger) setTrigger(null);
      return;
    }
    const next = parseMentionTrigger(draft, node.selectionStart ?? 0);
    if (next?.anchor === trigger?.anchor && next?.query === trigger?.query && next?.kind === trigger?.kind) {
      return;
    }
    setTrigger(next);
    setMentionIndex(0);
  }, [draft, trigger]);

  const submit = () => {
    const text = draft.trim();
    if (!text || disabled) return;

    // A slash line is an instruction to a plugin rather than a message: it is
    // parsed and dispatched, and nothing is said in the channel.
    const parsed = parseSlashLine(text, allSlash);
    if (parsed) {
      setDraft("");
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
    setTrigger(null);
    resetTyping();
    void onSend(composerHtml(text));
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // An open list owns the arrow keys and Enter. Only once nothing is open
    // does Enter go back to meaning send.
    if (slashOpen) {
      const action = handleSlashKey(event, { activeIndex: slashIndex, count: slashEntries.length });
      if (action) {
        event.preventDefault();
        if (action.kind === "move") setSlashIndex(action.index);
        else if (action.kind === "pick") pickSlash(slashEntries[action.index]);
        else setDraft("");
        return;
      }
    }
    if (trigger && candidates.length > 0) {
      const action = handleMentionKey(event, { activeIndex: mentionIndex, count: candidates.length });
      if (action) {
        event.preventDefault();
        if (action.kind === "move") setMentionIndex(action.index);
        else if (action.kind === "pick") pickMention(candidates[action.index]);
        else setTrigger(null);
        return;
      }
    }
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    submit();
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
        <InputBase
          inputRef={inputRef}
          multiline
          maxRows={6}
          value={draft}
          disabled={disabled}
          placeholder={`Message ${target}`}
          inputProps={{ "aria-label": `Message ${target}` }}
          onChange={(event) => {
            setDraft(event.target.value);
            notifyTyping();
          }}
          onKeyUp={syncTrigger}
          onClick={syncTrigger}
          onSelect={syncTrigger}
          onKeyDown={onKeyDown}
          sx={{
            flex: 1,
            fontSize: 13,
            // InputBase adds its own vertical padding on top of the row's, which
            // pushes a single line off the pill's centre line.
            "& .MuiInputBase-input": { padding: 0, lineHeight: 1.5 },
          }}
        />
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
