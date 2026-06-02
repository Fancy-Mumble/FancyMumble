/**
 * LiveDocMarkdownView - a live source view that shows the current document
 * as (Pandoc-flavored) Markdown and lets the user edit it directly.
 *
 *  - Syntax highlighting: a transparent textarea sits over a highlight.js
 *    overlay (the same technique as the chat `MarkdownInput`), so the raw
 *    markdown is coloured while remaining fully editable.
 *  - Live two-way sync: edits are debounced back into the document, and
 *    external/remote changes to the document flow back into the view -
 *    the two stay in sync without a manual "apply" step.
 *  - Readability: large base64 image payloads are collapsed to a short
 *    token (`⟦image#1 · 12 KB⟧`); the real bytes are restored losslessly
 *    before the markdown is applied back to the document.
 *
 * Because applying replaces the whole document, concurrent edits to the
 * rich view while you have *unapplied* markdown edits are resolved in favour
 * of the markdown text; when you have no pending edits, remote changes are
 * reflected live (and "Reload" forces a refresh from the document).
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Editor } from "@tiptap/react";
import hljs from "highlight.js/lib/common";
import "highlight.js/styles/github-dark.css";
import { editorHtmlToMarkdown, markdownToEditorHtml } from "./liveDocMarkdown";
import { abbreviateBase64, expandBase64 } from "./liveDocMarkdownImages";
import styles from "./LiveDocMarkdownView.module.css";

/** How long to wait after the last keystroke before pushing to the doc. */
const APPLY_DEBOUNCE_MS = 350;

/** Collapsed image tokens (`⟦…⟧`) are treated as atomic: locate their
 *  ranges so edits can never land inside one. */
function tokenRanges(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const re = /⟦[^⟧]*⟧/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push([m.index, m.index + m[0].length]);
  return out;
}

interface LiveDocMarkdownViewProps {
  readonly editor: Editor;
  readonly readOnly?: boolean;
}

export default function LiveDocMarkdownView({ editor, readOnly = false }: LiveDocMarkdownViewProps) {
  const { t } = useTranslation("chat");

  /** Read the document as collapsed markdown; refresh the payload map. */
  const mapRef = useRef<Map<string, string>>(new Map());
  const readDisplay = useCallback((): string => {
    try {
      const { text, map } = abbreviateBase64(editorHtmlToMarkdown(editor.getHTML()));
      mapRef.current = map;
      return text;
    } catch (e) {
      console.warn("[liveDocMarkdown] serialise failed:", e);
      return "";
    }
  }, [editor]);

  const [text, setText] = useState(readDisplay);
  const [editing, setEditing] = useState(false);

  // Refs so event handlers / cleanup see the latest values without
  // re-binding (which would thrash the editor `update` subscription).
  const textRef = useRef(text);
  const dirtyRef = useRef(false);
  const applyingRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  textRef.current = text;

  const taRef = useRef<HTMLTextAreaElement>(null);
  const overlayRef = useRef<HTMLPreElement>(null);

  /** Expand the collapsed base64 and replace the document content. */
  const applyToDoc = useCallback(
    (display: string) => {
      if (editor.isDestroyed || readOnly) return;
      const full = expandBase64(display, mapRef.current);
      applyingRef.current = true;
      try {
        editor.commands.setContent(markdownToEditorHtml(full));
      } finally {
        applyingRef.current = false;
      }
      dirtyRef.current = false;
      setEditing(false);
    },
    [editor, readOnly],
  );

  /** Pull the latest document content into the view (discards pending edits). */
  const reload = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    dirtyRef.current = false;
    setEditing(false);
    setText(readDisplay());
  }, [readDisplay]);

  // Live: reflect external/remote document changes back into the view when
  // there are no unapplied local edits (otherwise the local edits win and
  // are flushed to the doc by the debounce below).
  useEffect(() => {
    const onDocChange = () => {
      if (applyingRef.current || dirtyRef.current) return;
      const next = readDisplay();
      if (next !== textRef.current) setText(next);
    };
    editor.on("update", onDocChange);
    editor.on("create", onDocChange);
    return () => {
      editor.off("update", onDocChange);
      editor.off("create", onDocChange);
    };
  }, [editor, readDisplay]);

  // Flush pending edits to the document when leaving the markdown view.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (dirtyRef.current && !readOnly) applyToDoc(textRef.current);
    };
  }, [applyToDoc, readOnly]);

  const onChange = useCallback(
    (value: string, caret?: number) => {
      setText(value);
      dirtyRef.current = true;
      setEditing(true);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => applyToDoc(value), APPLY_DEBOUNCE_MS);
      if (caret !== undefined) {
        requestAnimationFrame(() => {
          const ta = taRef.current;
          if (ta) ta.selectionStart = ta.selectionEnd = caret;
        });
      }
    },
    [applyToDoc],
  );

  // Treat collapsed image chips as atomic: block edits that would land
  // *inside* a `⟦…⟧` token, and delete the whole token at once when a
  // backspace/delete touches it.  Uses the native `beforeinput` event so we
  // see the precise `inputType` and can pre-empt it.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    const handler = (e: InputEvent) => {
      const value = textRef.current;
      const ranges = tokenRanges(value);
      if (ranges.length === 0) return;
      const selStart = ta.selectionStart ?? 0;
      const selEnd = ta.selectionEnd ?? 0;
      const type = e.inputType;

      if (type.startsWith("delete")) {
        let from = selStart;
        let to = selEnd;
        if (selStart === selEnd) {
          if (type.toLowerCase().includes("backward")) from = selStart - 1;
          else to = selEnd + 1;
        }
        let hit = false;
        for (const [rf, rt] of ranges) {
          if (from < rt && to > rf) {
            from = Math.min(from, rf);
            to = Math.max(to, rt);
            hit = true;
          }
        }
        if (hit) {
          e.preventDefault();
          onChange(value.slice(0, Math.max(0, from)) + value.slice(to), Math.max(0, from));
        }
        return;
      }

      // Insertion / replacement: block if it would split a token (caret
      // strictly inside one, or a selection partially overlapping one).
      for (const [rf, rt] of ranges) {
        const overlaps = selStart < rt && selEnd > rf;
        const fullyCovers = selStart <= rf && selEnd >= rt;
        const caretInside = selStart > rf && selStart < rt;
        if ((overlaps && !fullyCovers) || caretInside) {
          e.preventDefault();
          return;
        }
      }
    };
    ta.addEventListener("beforeinput", handler);
    return () => ta.removeEventListener("beforeinput", handler);
  }, [onChange]);

  // Highlight the (collapsed) markdown source.  A trailing space keeps the
  // overlay's last line height in step with the textarea.
  const highlighted = useMemo(() => {
    const src = text.endsWith("\n") ? `${text} ` : text;
    let html: string;
    try {
      html = hljs.highlight(src, { language: "markdown", ignoreIllegals: true }).value;
    } catch {
      html = src.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    }
    // Render collapsed image tokens as chips (the `⟦…⟧` text contains no
    // HTML-special chars, so a plain substring wrap is safe).
    return html.replace(/⟦[^⟧]*⟧/g, (m) => `<span class="ld-md-imgchip">${m}</span>`);
  }, [text]);

  // Auto-grow the textarea to fit content (CSS keeps a one-page minimum);
  // the absolutely-positioned overlay tracks the box automatically.
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }, [text]);

  return (
    <div className={styles.root}>
      <div className={styles.bar}>
        <span className={styles.label}>{t("liveDoc.markdown.title", { defaultValue: "Markdown" })}</span>
        <span className={styles.flavor}>{t("liveDoc.markdown.flavor", { defaultValue: "Pandoc-flavored" })}</span>
        <span className={styles.status}>
          <span className={`${styles.dot} ${editing ? styles.dotEditing : ""}`} />
          {editing
            ? t("liveDoc.markdown.syncing", { defaultValue: "syncing…" })
            : t("liveDoc.markdown.synced", { defaultValue: "in sync" })}
        </span>
        <span className={styles.spacer} />
        <button type="button" className={styles.btn} onClick={reload}>
          {t("liveDoc.markdown.reload", { defaultValue: "Reload from document" })}
        </button>
      </div>

      <div className={styles.scroll}>
        <div
          className={styles.editorBox}
          onMouseDown={(e) => {
            // Clicking the empty pane below the text focuses the editor.
            if (e.target === e.currentTarget) taRef.current?.focus();
          }}
        >
          <pre
            ref={overlayRef}
            className={`${styles.overlay} hljs`}
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
          <textarea
            ref={taRef}
            className={styles.textarea}
            value={text}
          readOnly={readOnly}
          spellCheck={false}
          aria-label={t("liveDoc.markdown.title", { defaultValue: "Markdown" })}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Tab") return;
            e.preventDefault();
            const el = e.currentTarget;
            const { selectionStart, selectionEnd } = el;
            const next = text.slice(0, selectionStart) + "  " + text.slice(selectionEnd);
            onChange(next);
            requestAnimationFrame(() => {
              el.selectionStart = el.selectionEnd = selectionStart + 2;
            });
          }}
          />
        </div>
      </div>
    </div>
  );
}
