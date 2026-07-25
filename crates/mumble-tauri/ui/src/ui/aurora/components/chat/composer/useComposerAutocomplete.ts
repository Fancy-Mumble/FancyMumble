/**
 * Inline autocomplete for the Aurora composer: `@` mentions and `/` plugin
 * commands, driven by what is actually typed rather than by a picker button.
 *
 * The shared detection/ranking logic is reused verbatim from the Standard
 * client (`parseMentionTrigger`, `useMentionCandidates`, the slash parser), so
 * both interfaces resolve the same candidates in the same order. Only the
 * bridge differs: Standard reads a textarea's string offsets, while Aurora
 * edits a ProseMirror document, so trigger text is taken from the caret's text
 * block and picks are applied as document ranges.
 */
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import type { Editor } from "@tiptap/react";
import { sendPluginInteraction, useAppStore } from "@core/store";
import { parseMentionTrigger, type MentionTrigger } from "@core/utils/mentions";
import { collectSlashCommands, filterSlashCommands, type SlashCommandEntry } from "@core/plugins/tier1/manifest";
import { extractSlashQuery, parseSlashLine } from "@core/plugins/tier1/slashParser";
import { candidateInsertText, handleMentionKey, type MentionCandidate } from "@standard/components/chat/mention/MentionAutocomplete";
import { useMentionCandidates } from "@standard/components/chat/mention/useMentionCandidates";

/** The caret's text block plus where it starts in the document, which is all
 *  the string-based helpers need to reason about the line being typed. */
interface CaretLine {
  readonly text: string;
  readonly blockStart: number;
  readonly caret: number;
}

function caretLine(editor: Editor | null): CaretLine | null {
  if (!editor) return null;
  const { state } = editor;
  const { from, empty } = state.selection;
  // A selection is a deliberate range operation, never a trigger.
  if (!empty) return null;
  const blockStart = from - state.selection.$from.parentOffset;
  return { text: state.doc.textBetween(blockStart, from, "\n", "\n"), blockStart, caret: from };
}

export interface ComposerAutocomplete {
  readonly mentionCandidates: readonly MentionCandidate[];
  readonly mentionIndex: number;
  readonly slashEntries: readonly SlashCommandEntry[];
  readonly slashIndex: number;
  readonly setMentionIndex: (index: number) => void;
  readonly setSlashIndex: (index: number) => void;
  readonly pickMention: (candidate: MentionCandidate) => void;
  readonly pickSlash: (entry: SlashCommandEntry) => void;
  /** Re-read the caret after any edit or cursor move. */
  readonly refresh: () => void;
  /** Arrow/Enter/Tab/Escape while a popup is open. True = handled here, so
   *  the composer must not also treat the key as "send". */
  readonly handleKeyDown: (event: KeyboardEvent<HTMLElement>) => boolean;
  /** Run the draft as a slash command; true when it was one (so the caller
   *  skips the normal send path). */
  readonly submitSlashCommand: () => boolean;
}

export function useComposerAutocomplete(editor: Editor | null): ComposerAutocomplete {
  const [trigger, setTrigger] = useState<MentionTrigger | null>(null);
  const [line, setLine] = useState<CaretLine | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [slashIndex, setSlashIndex] = useState(0);
  const pluginManifests = useAppStore((state) => state.pluginManifests);
  const selectedChannel = useAppStore((state) => state.selectedChannel);

  const refresh = useCallback(() => {
    const current = caretLine(editor);
    setLine(current);
    setTrigger(current ? parseMentionTrigger(current.text, current.text.length) : null);
  }, [editor]);

  const mentionCandidates = useMentionCandidates(trigger?.kind ?? null, trigger?.query ?? "");

  const allSlashCommands = useMemo(() => collectSlashCommands(pluginManifests), [pluginManifests]);
  const slashQuery = line ? extractSlashQuery(line.text) : null;
  const slashEntries = useMemo(
    () => (slashQuery === null ? [] : filterSlashCommands(allSlashCommands, slashQuery)),
    [allSlashCommands, slashQuery],
  );

  // Keep the highlighted row inside the (re-filtered) list.
  useEffect(() => { if (mentionIndex >= mentionCandidates.length) setMentionIndex(0); }, [mentionCandidates.length, mentionIndex]);
  useEffect(() => { if (slashIndex >= slashEntries.length) setSlashIndex(0); }, [slashEntries.length, slashIndex]);

  const pickMention = useCallback((candidate: MentionCandidate) => {
    if (!editor || !trigger || !line) return;
    // `@&role` triggers carry one extra character before the query.
    const queryLength = trigger.query.length + (trigger.kind === "role" ? 2 : 1);
    const from = line.blockStart + trigger.anchor;
    editor.chain().focus()
      .deleteRange({ from, to: Math.max(from, line.blockStart + trigger.anchor + queryLength) })
      .insertContent(`${candidateInsertText(candidate)} `)
      .run();
    setTrigger(null);
  }, [editor, trigger, line]);

  const pickSlash = useCallback((entry: SlashCommandEntry) => {
    if (!editor || !line) return;
    editor.chain().focus()
      .deleteRange({ from: line.blockStart, to: line.caret })
      .insertContent(`/${entry.command.name} `)
      .run();
    setSlashIndex(0);
  }, [editor, line]);

  const submitSlashCommand = useCallback(() => {
    if (!editor) return false;
    const parsed = parseSlashLine(editor.getText(), allSlashCommands);
    if (!parsed) return false;
    if (parsed.errors.length > 0) {
      console.warn("[aurora-composer] slash command rejected:", parsed.errors.join("; "));
      return false;
    }
    void sendPluginInteraction(parsed.pluginName, parsed.kind, selectedChannel)
      .catch((reason) => console.warn("[aurora-composer] sendPluginInteraction failed:", reason));
    editor.commands.clearContent();
    return true;
  }, [editor, allSlashCommands, selectedChannel]);

  const slashOpen = slashQuery !== null && slashEntries.length > 0;
  const mentionOpen = !slashOpen && !!trigger && mentionCandidates.length > 0;

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    // The shared key mappers only read `event.key`; they are typed against the
    // Standard client's textarea, which Aurora's contenteditable stands in for.
    const shared = event as unknown as KeyboardEvent<HTMLTextAreaElement>;
    if (slashOpen) {
      const action = handleMentionKey(shared, { activeIndex: slashIndex, count: slashEntries.length });
      if (!action) return false;
      event.preventDefault();
      if (action.kind === "move") setSlashIndex(action.index);
      else if (action.kind === "pick") pickSlash(slashEntries[action.index]);
      else setLine(null);
      return true;
    }
    if (!mentionOpen) return false;
    const action = handleMentionKey(shared, { activeIndex: mentionIndex, count: mentionCandidates.length });
    if (!action) return false;
    event.preventDefault();
    if (action.kind === "move") setMentionIndex(action.index);
    else if (action.kind === "pick") pickMention(mentionCandidates[action.index]);
    else setTrigger(null);
    return true;
  }, [slashOpen, slashIndex, slashEntries, pickSlash, mentionOpen, mentionIndex, mentionCandidates, pickMention]);

  return {
    mentionCandidates: mentionOpen ? mentionCandidates : [],
    mentionIndex,
    slashEntries: slashOpen ? slashEntries : [],
    slashIndex,
    setMentionIndex,
    setSlashIndex,
    pickMention,
    pickSlash,
    refresh,
    handleKeyDown,
    submitSlashCommand,
  };
}
