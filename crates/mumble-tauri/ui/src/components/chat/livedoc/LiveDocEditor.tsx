/**
 * LiveDocEditor - word-processor-style Tiptap editor wired for
 * collaborative editing via Yjs.
 *
 * Owns the editor instance + page surface only.  All toolbar UI
 * lives in [`LiveDocToolbar`] so this module stays focused.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useEditor, EditorContent } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Collaboration from "@tiptap/extension-collaboration";
import Mathematics from "@tiptap/extension-mathematics";
import { yCursorPlugin } from "@tiptap/y-tiptap";
import type { WebsocketProvider } from "y-websocket";
import type { Node as PmNode } from "@tiptap/pm/model";
import TextAlign from "@tiptap/extension-text-align";
import { LiveDocImage } from "./LiveDocImage";
import FontFamily from "@tiptap/extension-font-family";
import Highlight from "@tiptap/extension-highlight";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import type * as Y from "yjs";
import "katex/dist/katex.min.css";
import { editorHtmlToMarkdown, markdownToEditorHtml } from "./liveDocMarkdown";
import LiveDocToolbar from "./LiveDocToolbar";
import { FontSize, Indent } from "./liveDocExtensions";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import MathEditPopover, { type MathEditTarget } from "./MathEditPopover";
import LiveDocTableControls from "./LiveDocTableControls";
import LiveDocMentionPopover, {
  mentionTriggerListeners,
} from "./LiveDocMentionPopover";
import { LiveDocMention, type MentionTriggerState } from "./liveDocMention";
import styles from "./LiveDocEditor.module.css";

interface LiveDocEditorProps {
  readonly doc: Y.Doc;
  readonly provider?: WebsocketProvider | null;
  readonly readOnly?: boolean;
  /** When true, render the page surface as white paper instead of
   *  the dark theme.  Useful as a print-preview / readability check. */
  readonly paperMode?: boolean;
  /** Receives a getter that returns the current document as Markdown
   *  (with `$...$` math preserved).  The parent uses this on Export or
   *  on persistence flushes. */
  readonly onReady?: (api: LiveDocEditorApi) => void;
}

function buildCollabCursor(user: { name: string; color: string }): HTMLElement {
  const caret = document.createElement("span");
  caret.classList.add("collaboration-cursor__caret");
  caret.style.color = user.color;
  const label = document.createElement("div");
  label.classList.add("collaboration-cursor__label");
  label.style.backgroundColor = user.color;
  label.setAttribute("data-name", user.name);
  caret.appendChild(label);
  return caret;
}

function makeCollaborationCursorExtension(awareness: NonNullable<WebsocketProvider["awareness"]>) {
  return Extension.create({
    name: "collaborationCursor",
    addProseMirrorPlugins() {
      return [yCursorPlugin(awareness, { cursorBuilder: buildCollabCursor })];
    },
  }).configure({});
}

/** Imperative handle exposed to parents. */
export interface LiveDocEditorApi {
  /** Serialise the current editor content to Markdown + LaTeX. */
  getMarkdown(): string;
  /** Serialise the current editor content to plain text. */
  getText(): string;
  /** Serialise the current editor content to HTML (used by PDF export). */
  getHtml(): string;
  /** Replace the document with `markdown`.  Used to seed a freshly
   *  opened document from a local `.md` file. */
  setMarkdown(markdown: string): void;
}

export default function LiveDocEditor({
  doc,
  provider = null,
  readOnly = false,
  paperMode = false,
  onReady,
}: LiveDocEditorProps) {
  const awareness = provider?.awareness ?? null;
  const { t } = useTranslation("chat");

  // Stable ref so the math click handler (defined before the editor)
  // can always reach the live editor instance.
  const editorRef = useRef<import("@tiptap/react").Editor | null>(null);
  // Page surface ref - used by LiveDocTableControls as the positioning
  // origin for its absolutely-placed floating toolbar.
  const pageRef = useRef<HTMLDivElement | null>(null);

  const [mathEdit, setMathEdit] = useState<MathEditTarget | null>(null);
  const [mentionTrigger, setMentionTrigger] = useState<MentionTriggerState | null>(null);

  // Register/unregister this component's setter with the shared listener
  // set that the mention plugin pushes updates into.  We keep a single
  // shared set (rather than a per-editor option callback) so the same
  // module can be code-split with the editor without circular deps.
  useEffect(() => {
    mentionTriggerListeners.add(setMentionTrigger);
    return () => {
      mentionTriggerListeners.delete(setMentionTrigger);
    };
  }, []);

  const handleMathClick = useCallback((node: PmNode, pos: number) => {
    const currentEditor = editorRef.current;
    if (!currentEditor) return;
    const dom = currentEditor.view.nodeDOM(pos) as HTMLElement | null;
    if (!dom || typeof dom.getBoundingClientRect !== "function") return;
    setMathEdit({
      type: node.type.name === "inlineMath" ? "inlineMath" : "blockMath",
      pos,
      latex: (node.attrs.latex as string | undefined) ?? "",
      rect: dom.getBoundingClientRect(),
    });
  }, []);

  const handleInsertMathBlock = useCallback(() => {
    const currentEditor = editorRef.current;
    if (!currentEditor) return;
    const placeholder = "\\LaTeX";
    currentEditor.chain().focus().insertBlockMath({ latex: placeholder }).run();
    // The math NodeView renders via React, so the DOM element is only
    // available after the next paint.  Defer the measurement and popover
    // open until then.
    requestAnimationFrame(() => {
      const current = editorRef.current;
      if (!current) return;
      const { state, view } = current;
      const { from } = state.selection;
      let nearest: number | null = null;
      let closestDist = Infinity;
      state.doc.nodesBetween(0, state.doc.content.size, (node, pos) => {
        if (node.type.name === "blockMath") {
          const dist = Math.abs(pos - from);
          if (dist < closestDist) {
            closestDist = dist;
            nearest = pos;
          }
        }
      });
      if (nearest === null) return;
      const dom = view.nodeDOM(nearest) as HTMLElement | null;
      if (!dom || typeof dom.getBoundingClientRect !== "function") return;
      setMathEdit({ type: "blockMath", pos: nearest, latex: placeholder, rect: dom.getBoundingClientRect() });
    });
  }, []);

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        // Disable StarterKit's undo/redo - Yjs manages collaborative
        // history so the state stays consistent across peers.  The
        // option is named `undoRedo` in Tiptap 3.
        undoRedo: false,
        // Tiptap 3 bundles link and underline inside StarterKit.
        // Disable them here so the explicit extensions below (which
        // carry custom config) are not registered twice.
        link: false,
        underline: false,
      }),
      Underline,
      Link.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({
        placeholder: t("liveDoc.newDocPlaceholder", { defaultValue: "Start typing..." }),
      }),
      Mathematics.configure({
        inlineOptions: { onClick: handleMathClick },
        blockOptions: { onClick: handleMathClick },
      }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      LiveDocImage.configure({ inline: false, allowBase64: true }),
      TextStyle,
      Color,
      FontFamily.configure({ types: ["textStyle"] }),
      FontSize,
      Highlight.configure({ multicolor: true }),
      Indent,
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      TaskList,
      TaskItem.configure({ nested: true }),
      LiveDocMention.configure({
        onChange: (state: MentionTriggerState | null) => {
          // Fan out to every subscribed setter; the only one in practice
          // is this editor's own setMentionTrigger, but the indirection
          // keeps the extension free of React.
          for (const fn of mentionTriggerListeners) fn(state);
        },
      }),
      Collaboration.configure({ document: doc }),
      ...(awareness ? [makeCollaborationCursorExtension(awareness)] : []),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, t, handleMathClick, awareness],
  );

  const editor = useEditor(
    {
      extensions,
      editable: !readOnly,
      editorProps: {
        attributes: { class: styles.editorContent, "aria-label": t("liveDoc.panelTitle") },
      },
    },
    [extensions, readOnly],
  );

  // Keep a stable ref so the API object always uses the latest live
  // editor, even if the instance is recreated.
  editorRef.current = editor;

  useEffect(() => {
    if (!editor || !onReady) return;
    onReady({
      getMarkdown: () => editorHtmlToMarkdown(editorRef.current?.getHTML() ?? ""),
      getText: () => editorRef.current?.getText() ?? "",
      getHtml: () => editorRef.current?.getHTML() ?? "",
      setMarkdown: (markdown) => {
        const html = markdownToEditorHtml(markdown);
        // Defer by one tick: the editor view is attached by EditorContent's
        // effect, which may not have fired yet when this callback is invoked
        // synchronously from onReady during the mount phase.
        setTimeout(() => {
          const e = editorRef.current;
          if (e && !e.isDestroyed) {
            e.commands.setContent(html);
          }
        }, 0);
      },
    });
  }, [editor, onReady]);

  if (!editor) {
    return <div className={styles.loading}>{t("liveDoc.connecting")}</div>;
  }

  return (
    <div className={styles.editorRoot}>
      <LiveDocToolbar editor={editor} onInsertMathBlock={handleInsertMathBlock} />
      <div
        className={styles.editorScroll}
        onClick={(e) => {
          // Click anywhere in the gray area or on the page surface
          // focuses the editor (matching Google Docs UX).  Only
          // intercept clicks that did not already land on an editable
          // element so we don't move the caret on a true text click.
          const target = e.target as HTMLElement;
          if (target.closest(`.${styles.editorContent}`)) return;
          // If the click was the tail of a drag-select that started
          // inside the editor and ended in the gray area, the editor
          // selection is non-empty.  Calling focus("end") in that case
          // would collapse the selection, so we bail out.
          if (!editor.state.selection.empty) return;
          editor.chain().focus("end").run();
        }}
      >
        <div
          ref={pageRef}
          className={`${styles.editorPage} ${paperMode ? styles.editorPagePaper : ""}`}
          data-livedoc-page=""
        >
          <EditorContent editor={editor} />
          <LiveDocTableControls editor={editor} pageRef={pageRef} />
        </div>
      </div>
      {mentionTrigger && (
        <LiveDocMentionPopover
          editor={editor}
          trigger={mentionTrigger}
          onClose={() => setMentionTrigger(null)}
        />
      )}
      {mathEdit && (
        <MathEditPopover
          target={mathEdit}
          onCancel={() => setMathEdit(null)}
          onApply={(latex) => {
            const e = editorRef.current;
            if (e) {
              const cmd = mathEdit.type === "inlineMath" ? "updateInlineMath" : "updateBlockMath";
              e.chain().focus()[cmd]({ latex, pos: mathEdit.pos }).run();
            }
            setMathEdit(null);
          }}
          onDelete={() => {
            const e = editorRef.current;
            if (e) {
              const cmd = mathEdit.type === "inlineMath" ? "deleteInlineMath" : "deleteBlockMath";
              e.chain().focus()[cmd]({ pos: mathEdit.pos }).run();
            }
            setMathEdit(null);
          }}
        />
      )}
    </div>
  );
}

// Markdown serialisation lives in `./liveDocMarkdown.ts`.  The names
// `markdownFromEditorHtml` / `editorHtmlFromMarkdown` are kept as
// re-exports for callers (and tests) that imported them from here.
export {
  editorHtmlToMarkdown as markdownFromEditorHtml,
  markdownToEditorHtml as editorHtmlFromMarkdown,
} from "./liveDocMarkdown";
