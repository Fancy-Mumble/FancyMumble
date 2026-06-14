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
import { type MentionAttrs, type MentionTriggerState } from "./liveDocMention";

const POPUP_WIDTH = 260;
const POPUP_MARGIN = 12;

interface LiveDocMentionPopoverProps {
  readonly editor: Editor;
  /** Reactive trigger state - updated by `liveDocMention` plugin. */
  readonly trigger: MentionTriggerState;
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
  const candidates = useMentionCandidates(trigger.kind, trigger.query);

  // Reset highlight when the candidate set changes underneath us.
  useEffect(() => {
    if (activeIndex >= candidates.length) setActiveIndex(0);
  }, [candidates.length, activeIndex]);

  const insertCandidate = useCallback(
    (c: MentionCandidate) => {
      const attrs = candidateToAttrs(c);
      editor
        .chain()
        .focus()
        .insertContentAt({ from: trigger.from, to: trigger.to }, [
          { type: "mention", attrs },
          { type: "text", text: " " },
        ])
        .run();
      onClose();
    },
    [editor, trigger, onClose],
  );

  // Keyboard handling at the document level, restricted to events that
  // target the editor surface (so a user typing in another input on the
  // page is not affected).
  useEffect(() => {
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
          editor.commands.focus();
          onClose();
          break;
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [candidates, activeIndex, editor, insertCandidate, onClose]);

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

/** Module-shared set of React setters that the mention plugin pushes
 *  trigger updates into.  `LiveDocEditor` registers its own setter on
 *  mount, the plugin (installed via `LiveDocMention.configure`) calls
 *  every setter on each ProseMirror view update. */
export const mentionTriggerListeners = new Set<
  (state: MentionTriggerState | null) => void
>();
