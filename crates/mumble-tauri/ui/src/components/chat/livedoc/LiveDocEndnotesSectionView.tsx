/**
 * LiveDocEndnotesSectionView - React node view for the generated
 * "Endnotes" block.  Renders a live, numbered list of the document's
 * endnotes; each note's text is editable inline (committed on blur /
 * Enter) and a back-reference jumps to its marker in the body.
 */

import { useEffect, useRef, useState } from "react";
import { NodeViewWrapper, type NodeViewProps, type Editor } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import { ArrowUpIcon } from "../../../icons";
import { scrollToPos } from "./liveDocHeadings";
import { extractEndnotes, type EndnoteEntry } from "./liveDocEndnotes";
import { useLiveDocEndnotes } from "./useLiveDocEndnotes";
import styles from "./LiveDocReferences.module.css";

function commitNoteText(editor: Editor, noteId: string, value: string): void {
  const current = extractEndnotes(editor.state.doc).find((e) => e.noteId === noteId);
  if (!current) return;
  editor
    .chain()
    .command(({ tr }) => {
      tr.setNodeAttribute(current.pos, "text", value);
      return true;
    })
    .run();
}

interface EndnoteItemRowProps {
  readonly editor: Editor;
  readonly entry: EndnoteEntry;
}

function EndnoteItemRow({ editor, entry }: EndnoteItemRowProps) {
  const { t } = useTranslation("chat");
  const [draft, setDraft] = useState(entry.text);
  const lastExternal = useRef(entry.text);

  useEffect(() => {
    if (entry.text !== lastExternal.current) {
      lastExternal.current = entry.text;
      setDraft(entry.text);
    }
  }, [entry.text]);

  const commit = () => {
    if (draft !== entry.text) commitNoteText(editor, entry.noteId, draft);
  };

  return (
    <li className={styles.endnoteItem} data-livedoc-endnote-item={entry.noteId}>
      <span className={styles.endnoteNumber}>{entry.number}.</span>
      <input
        className={styles.endnoteInput}
        value={draft}
        placeholder={t("liveDoc.endnotes.notePlaceholder")}
        aria-label={t("liveDoc.endnotes.noteAria", { number: entry.number })}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      <button
        type="button"
        className={styles.endnoteBackRef}
        onClick={() => scrollToPos(editor, entry.pos)}
        title={t("liveDoc.endnotes.jumpToMarker")}
        aria-label={t("liveDoc.endnotes.jumpToMarker")}
      >
        <ArrowUpIcon width={13} height={13} aria-hidden="true" />
      </button>
    </li>
  );
}

export default function LiveDocEndnotesSectionView({ editor }: Readonly<NodeViewProps>) {
  const { t } = useTranslation("chat");
  const { entries } = useLiveDocEndnotes(editor);

  return (
    <NodeViewWrapper
      className={styles.endnotes}
      data-livedoc-endnotes=""
      contentEditable={false}
      suppressContentEditableWarning
    >
      <div className={styles.endnotesHeader}>
        <span className={styles.endnotesTitle}>{t("liveDoc.endnotes.title")}</span>
      </div>
      {entries.length === 0 ? (
        <p className={styles.endnotesEmpty}>{t("liveDoc.endnotes.empty")}</p>
      ) : (
        <ol className={styles.endnotesList}>
          {entries.map((entry) => (
            <EndnoteItemRow key={entry.noteId} editor={editor} entry={entry} />
          ))}
        </ol>
      )}
    </NodeViewWrapper>
  );
}
