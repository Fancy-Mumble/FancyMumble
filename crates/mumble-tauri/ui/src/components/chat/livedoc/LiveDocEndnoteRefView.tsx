/**
 * LiveDocEndnoteRefView - inline superscript marker for an endnote.
 *
 * Shows the live 1-based number; clicking it scrolls to the matching
 * entry in the generated endnotes section (which is found by its
 * `data-livedoc-endnote-item` id in the rendered DOM).
 */

import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useLiveDocEndnotes } from "./useLiveDocEndnotes";
import { endnoteNumberFor } from "./liveDocEndnotes";
import styles from "./LiveDocReferences.module.css";

function scrollToNoteItem(noteId: string): void {
  const item = document.querySelector(`[data-livedoc-endnote-item="${noteId}"]`);
  if (item instanceof HTMLElement) {
    item.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

export default function LiveDocEndnoteRefView({ editor, node }: Readonly<NodeViewProps>) {
  const { entries } = useLiveDocEndnotes(editor);
  const noteId = String(node.attrs.noteId ?? "");
  const number = endnoteNumberFor(noteId, entries) ?? "?";

  return (
    <NodeViewWrapper
      as="sup"
      className={styles.endnoteRef}
      data-livedoc-endnote=""
      contentEditable={false}
      suppressContentEditableWarning
      role="link"
      tabIndex={0}
      title={String(node.attrs.text ?? "")}
      onClick={() => scrollToNoteItem(noteId)}
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          scrollToNoteItem(noteId);
        }
      }}
    >
      {number}
    </NodeViewWrapper>
  );
}
