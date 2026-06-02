/**
 * LiveDocMarkdownView - a source view that shows the current document as
 * (Pandoc-flavored) Markdown and lets the user edit it directly.
 *
 * The markdown is produced by the shared `editorHtmlToMarkdown` serializer,
 * which keeps the constructs standard Markdown can't express as raw HTML
 * (page/section breaks, aligned blocks, tables/figures, citations,
 * cross-references, coloured spans, `$…$` / `$$…$$` math) - i.e. a
 * Pandoc-style "Markdown + raw HTML" document.  Applying converts back via
 * `markdownToEditorHtml` and replaces the document content, which then
 * syncs to collaborators via Yjs.
 *
 * Editing is seeded once on entry; "Reload" re-reads the live document and
 * changes are written back on "Apply" or when leaving the view.  Because
 * applying replaces the whole document, it is a single-author action -
 * concurrent edits made while the markdown view is open are overwritten.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Editor } from "@tiptap/react";
import { editorHtmlToMarkdown, markdownToEditorHtml } from "./liveDocMarkdown";
import styles from "./LiveDocMarkdownView.module.css";

interface LiveDocMarkdownViewProps {
  readonly editor: Editor;
  readonly readOnly?: boolean;
}

function readMarkdown(editor: Editor): string {
  try {
    return editorHtmlToMarkdown(editor.getHTML());
  } catch (e) {
    console.warn("[liveDocMarkdown] serialise failed:", e);
    return "";
  }
}

export default function LiveDocMarkdownView({ editor, readOnly = false }: LiveDocMarkdownViewProps) {
  const { t } = useTranslation("chat");
  const [text, setText] = useState(() => readMarkdown(editor));
  const [dirty, setDirty] = useState(false);

  // Refs so the unmount-time auto-apply sees the latest value without
  // re-binding the cleanup effect on every keystroke.
  const textRef = useRef(text);
  const dirtyRef = useRef(false);
  textRef.current = text;
  dirtyRef.current = dirty;

  const apply = useCallback(
    (markdown: string) => {
      if (editor.isDestroyed) return;
      const html = markdownToEditorHtml(markdown);
      editor.commands.setContent(html);
      setDirty(false);
      dirtyRef.current = false;
    },
    [editor],
  );

  const reload = useCallback(() => {
    setText(readMarkdown(editor));
    setDirty(false);
  }, [editor]);

  // Write pending edits back when the view is closed (mode toggled off).
  useEffect(() => {
    return () => {
      if (dirtyRef.current && !readOnly) apply(textRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={styles.root}>
      <div className={styles.bar}>
        <span className={styles.label}>{t("liveDoc.markdown.title", { defaultValue: "Markdown" })}</span>
        <span className={styles.flavor}>{t("liveDoc.markdown.flavor", { defaultValue: "Pandoc-flavored" })}</span>
        {dirty && <span className={styles.dirty}>● {t("liveDoc.markdown.unsaved", { defaultValue: "unapplied changes" })}</span>}
        <span className={styles.spacer} />
        <button type="button" className={styles.btn} onClick={reload}>
          {t("liveDoc.markdown.reload", { defaultValue: "Reload from document" })}
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={() => apply(text)}
          disabled={readOnly || !dirty}
        >
          {t("liveDoc.markdown.apply", { defaultValue: "Apply to document" })}
        </button>
      </div>
      <div className={styles.scroll}>
        <textarea
          className={styles.textarea}
          value={text}
          readOnly={readOnly}
          spellCheck={false}
          aria-label={t("liveDoc.markdown.title", { defaultValue: "Markdown" })}
          onChange={(e) => {
            setText(e.target.value);
            setDirty(true);
          }}
          onKeyDown={(e) => {
            // Ctrl/Cmd+Enter applies; Tab inserts two spaces.
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
              e.preventDefault();
              apply(text);
            } else if (e.key === "Tab") {
              e.preventDefault();
              const el = e.currentTarget;
              const { selectionStart, selectionEnd } = el;
              const next = text.slice(0, selectionStart) + "  " + text.slice(selectionEnd);
              setText(next);
              setDirty(true);
              requestAnimationFrame(() => {
                el.selectionStart = el.selectionEnd = selectionStart + 2;
              });
            }
          }}
        />
      </div>
    </div>
  );
}
