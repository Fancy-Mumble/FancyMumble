/**
 * LiveDocMentionPopover - thin host around the shared
 * `MentionAutocomplete` UI used by the chat composer.  Subscribes to
 * the editor's mention-trigger plugin, looks up candidates via the
 * shared `useMentionCandidates` hook, and inserts a mention node when
 * the user picks one.
 *
 * Keyboard navigation (Arrow / Enter / Tab / Escape) is handled here
 * via a DOM-level keydown listener so the Tiptap view doesn't need a
 * custom keymap.
 */

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import MentionAutocomplete, {
  type MentionCandidate,
  handleMentionKey,
} from "../mention/MentionAutocomplete";
import { useMentionCandidates } from "../mention/useMentionCandidates";
import {
  mentionPluginKey,
  type MentionAttrs,
  type MentionTriggerState,
} from "./liveDocMention";

const POPUP_WIDTH = 260;
const POPUP_MARGIN = 12;

interface LiveDocMentionPopoverProps {
  readonly editor: Editor;
  /** Reactive trigger state - updated by `liveDocMention` plugin. */
  readonly trigger: MentionTriggerState | null;
  readonly onClose: () => void;
}

function candidateToAttrs(c: MentionCandidate): MentionAttrs {
  switch (c.kind) {
    case "user":
      return { variant: "user", target: String(c.session), label: c.name };
    case "role":
      return { variant: "role", target: c.name, label: c.name };
    case "everyone":
      return { variant: "everyone", target: "", label: "everyone" };
    case "here":
      return { variant: "here", target: "", label: "here" };
  }
}

export default function LiveDocMentionPopover({
  editor,
  trigger,
  onClose,
}: LiveDocMentionPopoverProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const candidates = useMentionCandidates(
    trigger?.kind ?? null,
    trigger?.query ?? "",
  );

  // Reset highlight when the candidate set changes underneath us.
  useEffect(() => {
    if (activeIndex >= candidates.length) setActiveIndex(0);
  }, [candidates.length, activeIndex]);

  const insertCandidate = useCallback(
    (c: MentionCandidate) => {
      if (!trigger) return;
      const attrs = candidateToAttrs(c);
      // Replace the typed `@token` range with a mention node + trailing
      // space so the caret lands after the chip ready for more typing.
      editor
        .chain()
        .focus()
        .insertContentAt({ from: trigger.from, to: trigger.to }, [
          { type: "mention", attrs },
          { type: "text", text: " " },
        ])
        .run();
      // Plugin's view.update fires after the dispatch and clears the
      // trigger; call onClose for the immediate UI close as well.
      onClose();
    },
    [editor, trigger, onClose],
  );

  // Keyboard handling at the document level, restricted to events that
  // target the editor surface (so a user typing in another input on the
  // page is not affected).
  useEffect(() => {
    if (!trigger) return;
    const dom = editor.view.dom;
    const onKey = (e: KeyboardEvent) => {
      if (!dom.contains(e.target as Node)) return;
      const action = handleMentionKey(
        e as unknown as React.KeyboardEvent<HTMLTextAreaElement>,
        { activeIndex, count: candidates.length },
      );
      if (!action) return;
      e.preventDefault();
      e.stopPropagation();
      switch (action.kind) {
        case "move":
          setActiveIndex(action.index);
          break;
        case "pick":
          if (candidates[action.index]) insertCandidate(candidates[action.index]);
          break;
        case "close":
          // Drop the editor's own trigger state by deleting the active
          // `@token` and dispatching a no-op selection update.  The
          // plugin will see no trigger on next update and report null.
          editor.commands.focus();
          onClose();
          break;
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [trigger, candidates, activeIndex, editor, insertCandidate, onClose]);

  if (!trigger) return null;

  const left = Math.max(
    POPUP_MARGIN,
    Math.min(trigger.rect.left, window.innerWidth - POPUP_WIDTH - POPUP_MARGIN),
  );
  const top = trigger.rect.bottom + 4;

  return createPortal(
    <div
      style={{
        position: "fixed",
        top,
        left,
        width: POPUP_WIDTH,
        zIndex: 1000,
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <MentionAutocomplete
        candidates={candidates}
        activeIndex={activeIndex}
        onPick={insertCandidate}
        onActiveIndexChange={setActiveIndex}
      />
    </div>,
    document.body,
  );
}

/** Subscribe to mention-trigger plugin updates on the given editor. */
export function useMentionTriggerState(editor: Editor | null): {
  trigger: MentionTriggerState | null;
  clear: () => void;
} {
  const [trigger, setTrigger] = useState<MentionTriggerState | null>(null);

  useEffect(() => {
    if (!editor) {
      setTrigger(null);
      return;
    }
    // The plugin instance stored on the editor pushes updates via its
    // `onChange` option, configured when the extension is added.  We
    // bridge that callback to setState by replacing the option's
    // function via the global registry below.
    mentionTriggerListeners.add(setTrigger);
    return () => {
      mentionTriggerListeners.delete(setTrigger);
    };
  }, [editor]);

  const clear = useCallback(() => setTrigger(null), []);
  return { trigger, clear };
}

/** Shared set of React state setters that should receive mention-trigger
 *  updates.  Populated by `useMentionTriggerState` and drained by the
 *  plugin's `onChange` callback installed by `LiveDocEditor`. */
export const mentionTriggerListeners = new Set<
  (state: MentionTriggerState | null) => void
>();

export { mentionPluginKey };
