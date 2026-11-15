import { useEffect, useRef } from "react";

/**
 * Whether this keystroke belongs to something being written in.
 *
 * `isContentEditable` is the browser's own answer and the one to trust, since
 * it accounts for editability inherited from an ancestor. The attribute is
 * checked as well because that answer is not available everywhere the client's
 * components are rendered - jsdom, where the tests run, does not implement it -
 * and a guard that silently stopped guarding under test is not much of a guard.
 */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (/^(input|textarea|select)$/i.test(target.tagName)) return true;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  return target.closest("[contenteditable='true'], [contenteditable='']") !== null;
}

/**
 * Undo and redo, from anywhere on the page the editor is on.
 *
 * Bound to the window rather than to the canvas, and that is the whole point.
 * The canvas is a `tabIndex={0}` div, so keys bound on it arrive only while it
 * holds focus - and almost everything an operator does with the graph takes
 * focus off it. Press the Undo button once and focus is on the button; open
 * the block browser and it is in the drawer; load the page and it is nowhere
 * at all. In every one of those, Ctrl+Z did nothing, which reads as an editor
 * that has no undo rather than as one you have to click the canvas to reach.
 *
 * Undo belongs to the page in any case, not to the canvas: the history is what
 * the *page* is holding, which is why `history` is the editor's prop and not
 * the canvas's. Anything else on the page that edits the same graph - the
 * design editor, which opens over the canvas - therefore gets the same
 * shortcut for free.
 *
 * Two things are deliberately left alone:
 *
 * * **A field being typed into.** Inside an input, a textarea or the rich-text
 *   editor, Ctrl+Z is that field's own undo - the word just typed, not the
 *   node deleted before it. Whatever comes back out of the field then reaches
 *   the graph as an ordinary edit.
 * * **A keystroke something nearer has already taken.** The design editor
 *   binds these on its own panel, so that a press inside it is handled once,
 *   there, rather than twice.
 */
export function useHistoryKeys(undo?: () => void, redo?: () => void): void {
  // Read at the moment of the press, so the listener can be bound once. Both
  // callbacks are rebuilt whenever the graph changes, which is every edit.
  const live = useRef({ undo, redo });
  live.current = { undo, redo };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      // Ctrl+Y and Ctrl+Shift+Z are the same gesture on two platforms, and an
      // editor that knew only one of them is broken on the other.
      const key = event.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      if (event.defaultPrevented) return;
      if (isTyping(event.target)) return;
      event.preventDefault();
      if (key === "y" || event.shiftKey) live.current.redo?.();
      else live.current.undo?.();
    };
    globalThis.addEventListener("keydown", onKey);
    return () => globalThis.removeEventListener("keydown", onKey);
  }, []);
}
