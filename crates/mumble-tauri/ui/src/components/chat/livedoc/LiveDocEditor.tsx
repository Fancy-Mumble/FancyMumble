/**
 * LiveDocEditor - word-processor-style Tiptap editor wired for
 * collaborative editing via Yjs.
 *
 * Owns the editor instance + page surface only.  All chrome (the
 * Word-style ribbon: title bar, tabs and grouped controls) lives in
 * [`LiveDocRibbon`] so this module stays focused.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { useEditor, EditorContent } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { createLowlight, common } from "lowlight";
import LiveDocCodeBlock from "./LiveDocCodeBlock";
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
import { insertEditorImage, imageFileFromClipboard } from "./liveDocImageInsert";
import { FontSize, Indent } from "./liveDocExtensions";
import { PageBreak, SectionBreak } from "./liveDocPageBreak";
import { LiveDocPaginationDecorations } from "./liveDocPaginationDecorations";
import { TableOfContents } from "./liveDocToc";
import { Bookmark } from "./liveDocBookmark";
import { Caption } from "./liveDocCaption";
import { CrossReference } from "./liveDocCrossRef";
import { EndnoteRef } from "./liveDocEndnote";
import { EndnotesSection } from "./liveDocEndnotesSection";
import { Citation } from "./liveDocCitation";
import { Bibliography } from "./liveDocBibliography";
import { LiveDocCitationStore } from "./liveDocCitationStore";
import { useLiveDocCitations } from "./useLiveDocCitations";
import LiveDocOutline from "./LiveDocOutline";
import LiveDocHeaderFooter from "./LiveDocHeaderFooter";
import LiveDocRibbon, { type LiveDocChrome } from "./LiveDocRibbon";
import LiveDocDrawModal from "./LiveDocDrawModal";
import LiveDocMarkdownView from "./LiveDocMarkdownView";
import {
  useLiveDocPageSetup,
  setLiveDocPageSetup,
  pageGeometryPx,
  useLiveDocDecoration,
  useLiveDocHeaderFooter,
  BORDER_WIDTH_PX,
} from "./useLiveDoc";
import { pageContentHeightPx } from "./liveDocPagination";
import { useLiveDocPageCount } from "./useLiveDocPageCount";
import { LiveDocRulerHorizontal, LiveDocRulerVertical } from "./LiveDocRuler";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
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
  /** Document + window actions surfaced by the ribbon's title bar and
   *  File backstage menu (rename/save/export/publish/history/close...). */
  readonly chrome: LiveDocChrome;
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
  /** Resize and insert `file` as an inline image at the current
   *  selection.  Used by the drag-drop handler. */
  insertImageFromFile(file: File): Promise<void>;
  /** Insert a "next page" section break at the caret. */
  insertSectionBreak(): void;
  /** Insert a cover page (centred title + subtitle + page break) at the
   *  very top of the document. */
  insertCoverPage(title: string): void;
}

export default function LiveDocEditor({
  doc,
  provider = null,
  readOnly = false,
  chrome,
  onReady,
}: LiveDocEditorProps) {
  const awareness = provider?.awareness ?? null;
  const { t } = useTranslation("chat");

  // Document page geometry (size / orientation / margins) is shared via
  // the Yjs `meta` map; feed it into the `--ld-*` custom properties that
  // both the page surface and the rulers read, so they stay in sync.
  const pageSetup = useLiveDocPageSetup(doc);
  const geo = pageGeometryPx(pageSetup);
  const decoration = useLiveDocDecoration(doc);
  const headerFooter = useLiveDocHeaderFooter(doc);

  // Live margin preview while a ruler handle is being dragged.  `undefined`
  // means "not dragging this axis", so the committed geometry applies.
  const [marginDrag, setMarginDrag] = useState<{ x?: number; y?: number }>({});
  const [rulerDragAxis, setRulerDragAxis] = useState<"x" | "y" | null>(null);
  const padX = marginDrag.x ?? geo.marginX;
  const padY = marginDrag.y ?? geo.marginY;
  // Keep the content column at least this wide/tall when dragging a handle.
  const MARGIN_MIN_PX = 12;
  const MARGIN_GAP_PX = 96;
  const marginMaxX = Math.max(MARGIN_MIN_PX, Math.round(geo.width / 2 - MARGIN_GAP_PX));
  const marginMaxY = Math.max(MARGIN_MIN_PX, Math.round(geo.height / 2 - MARGIN_GAP_PX));

  const previewMarginX = useCallback((px: number) => setMarginDrag((d) => ({ ...d, x: px })), []);
  const previewMarginY = useCallback((px: number) => setMarginDrag((d) => ({ ...d, y: px })), []);
  const commitMarginX = useCallback(
    (px: number) => {
      setLiveDocPageSetup(doc, { marginX: px });
      setMarginDrag((d) => ({ ...d, x: undefined }));
    },
    [doc],
  );
  const commitMarginY = useCallback(
    (px: number) => {
      setLiveDocPageSetup(doc, { marginY: px });
      setMarginDrag((d) => ({ ...d, y: undefined }));
    },
    [doc],
  );

  const pageVars = {
    "--ld-page-w": `${geo.width}px`,
    "--ld-page-h": `${geo.height}px`,
    "--ld-pad-x": `${padX}px`,
    "--ld-pad-y": `${padY}px`,
    "--ld-columns": String(pageSetup.columns ?? 1),
  } as CSSProperties;
  const rootVars = {
    "--ld-pagebreak-label": `"${t("liveDoc.pageBreakLabel", { defaultValue: "Page break" })}"`,
    "--ld-sectionbreak-label": `"${t("liveDoc.sectionBreakLabel", { defaultValue: "Section break" })}"`,
  } as CSSProperties;

  // Stable ref so the math click handler (defined before the editor)
  // can always reach the live editor instance.
  const editorRef = useRef<import("@tiptap/react").Editor | null>(null);
  // Page surface ref - used by LiveDocTableControls as the positioning
  // origin for its absolutely-placed floating toolbar.
  const pageRef = useRef<HTMLDivElement | null>(null);

  const [mathEdit, setMathEdit] = useState<MathEditTarget | null>(null);
  const [mentionTrigger, setMentionTrigger] = useState<MentionTriggerState | null>(null);
  const [outlineOpen, setOutlineOpen] = useState(false);
  // Paper / print-layout preview (white page) - toggled from the View tab.
  const [paperMode, setPaperMode] = useState(false);
  // Freehand drawing modal (Draw tab).
  const [drawOpen, setDrawOpen] = useState(false);
  // Markdown source view (View tab) - swaps the page surface for an
  // editable Pandoc-flavored markdown view of the same document.
  const [markdownMode, setMarkdownMode] = useState(false);

  // Shared editor commands used by both the imperative API (onReady) and
  // the ribbon controls, so the two paths stay in lockstep.
  const insertCoverPageWithTitle = useCallback(
    (title: string) => {
      const e = editorRef.current;
      if (!e || e.isDestroyed) return;
      e.chain()
        .focus()
        .insertContentAt(0, [
          {
            type: "heading",
            attrs: { level: 1, textAlign: "center" },
            content: title ? [{ type: "text", text: title }] : [],
          },
          {
            type: "paragraph",
            attrs: { textAlign: "center" },
            content: [{ type: "text", text: t("liveDoc.coverSubtitlePlaceholder", { defaultValue: "Subtitle" }) }],
          },
          { type: "pageBreak" },
        ])
        .run();
    },
    [t],
  );
  const insertSectionBreak = useCallback(() => {
    editorRef.current?.chain().focus().setSectionBreak().run();
  }, []);
  const handleInsertDrawing = useCallback((file: File) => {
    const e = editorRef.current;
    if (e && !e.isDestroyed) {
      void insertEditorImage(e, file).catch((err) =>
        console.warn("live-doc drawing insert failed:", err),
      );
    }
  }, []);

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

  const lowlight = useMemo(() => createLowlight(common), []);

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
        // Replaced by CodeBlockLowlight below.
        codeBlock: false,
      }),
      CodeBlockLowlight.extend({
        addNodeView() {
          return ReactNodeViewRenderer(LiveDocCodeBlock);
        },
      }).configure({ lowlight }),
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
      Subscript,
      Superscript,
      PageBreak,
      SectionBreak,
      LiveDocPaginationDecorations,
      TableOfContents,
      Bookmark,
      Caption,
      CrossReference,
      EndnoteRef,
      EndnotesSection,
      Citation,
      Bibliography,
      LiveDocCitationStore,
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
    [doc, t, handleMathClick, awareness],
  );

  const editor = useEditor(
    {
      extensions,
      editable: !readOnly,
      editorProps: {
        attributes: { class: styles.editorContent, "aria-label": t("liveDoc.panelTitle") },
        // Insert pasted images directly into the document.  Without this
        // the chat's global paste listener would hijack the image and
        // send it as a chat message instead (see useChatSend).
        handlePaste: (_view, event) => {
          const file = imageFileFromClipboard(event.clipboardData);
          const current = editorRef.current;
          if (!file || !current) return false;
          void insertEditorImage(current, file).catch((e) =>
            console.warn("live-doc image paste failed:", e),
          );
          return true;
        },
      },
    },
    [extensions, readOnly],
  );

  // Keep a stable ref so the API object always uses the latest live
  // editor, even if the instance is recreated.
  editorRef.current = editor;

  // Non-destructive page-count estimate for the status indicator and the
  // optional footer page-number token.
  // Uses the committed (not mid-drag) margin so the page-count estimate
  // doesn't re-run its ResizeObserver on every pointermove; it settles when
  // the drag commits.
  const pageContentHeight = pageContentHeightPx(geo.height, geo.marginY);
  const pageCount = useLiveDocPageCount(editor, pageContentHeight);

  // Compute formatted citations + bibliography once per change and publish
  // them to the shared citation store the node views read from.
  useLiveDocCitations(editor, doc);

  // Feed the live page geometry and footer config to the pagination plugin so
  // the visible page-break gutters land at the right offsets with correct
  // footer content.  Decorations are view-only (no Yjs steps).
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const footer = headerFooter.enabled
      ? {
          footerText: headerFooter.footer,
          showPageNumber: headerFooter.showPageNumber,
          pageCount,
          pageNumberLabel: (n: number) =>
            pageCount > 1
              ? t("liveDoc.headerFooter.pageNumberOf", { number: n, total: pageCount })
              : t("liveDoc.headerFooter.pageNumber", { number: n }),
        }
      : undefined;
    editor.commands.setPaginationMetrics({ pageContentHeight, marginY: geo.marginY, footer });
  }, [editor, pageContentHeight, geo.marginY, headerFooter, pageCount, t]);

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
      insertImageFromFile: async (file) => {
        const e = editorRef.current;
        if (e && !e.isDestroyed) {
          await insertEditorImage(e, file);
        }
      },
      insertSectionBreak: () => insertSectionBreak(),
      insertCoverPage: (title) => insertCoverPageWithTitle(title),
    });
  }, [editor, onReady, t, insertSectionBreak, insertCoverPageWithTitle]);

  if (!editor) {
    return <div className={styles.loading}>{t("liveDoc.connecting")}</div>;
  }

  return (
    <div className={styles.editorRoot} data-livedoc-editor="" style={rootVars}>
      <LiveDocRibbon
        editor={editor}
        doc={doc}
        chrome={chrome}
        pageCount={pageCount}
        outlineOpen={outlineOpen}
        onToggleOutline={() => setOutlineOpen((v) => !v)}
        paperMode={paperMode}
        onTogglePaperMode={() => setPaperMode((v) => !v)}
        onInsertCoverPage={() => insertCoverPageWithTitle(chrome.title)}
        onInsertSectionBreak={insertSectionBreak}
        onInsertMathBlock={handleInsertMathBlock}
        onOpenDraw={() => setDrawOpen(true)}
        markdownMode={markdownMode}
        onToggleMarkdown={() => setMarkdownMode((v) => !v)}
      />
      <div className={styles.editorBody}>
        {markdownMode ? (
          <LiveDocMarkdownView editor={editor} readOnly={readOnly} />
        ) : (
        <>
        {outlineOpen && (
          <LiveDocOutline editor={editor} onClose={() => setOutlineOpen(false)} />
        )}
        <div
          className={styles.editorScroll}
          style={pageVars}
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
        <LiveDocRulerHorizontal
          marginPx={padX}
          pageSizePx={geo.width}
          rulerUnit={pageSetup.rulerUnit}
          min={MARGIN_MIN_PX}
          max={marginMaxX}
          interactive={!readOnly}
          onPreview={previewMarginX}
          onCommit={commitMarginX}
          onDragChange={(dragging) => setRulerDragAxis(dragging ? "x" : null)}
        />
        <div className={styles.pageGrid}>
          <LiveDocRulerVertical
            marginPx={padY}
            pageSizePx={geo.height}
            rulerUnit={pageSetup.rulerUnit}
            min={MARGIN_MIN_PX}
            max={marginMaxY}
            interactive={!readOnly}
            onPreview={previewMarginY}
            onCommit={commitMarginY}
            onDragChange={(dragging) => setRulerDragAxis(dragging ? "y" : null)}
          />
        <div className={styles.pageArea}>
            <div
              ref={pageRef}
              className={`${styles.editorPage} ${paperMode ? styles.editorPagePaper : ""}`}
              data-livedoc-page=""
            >
              {decoration.border !== "none" && (
                <div
                  className={styles.pageBorder}
                  style={{ borderWidth: BORDER_WIDTH_PX[decoration.border] }}
                  aria-hidden="true"
                />
              )}
              {decoration.watermark.trim() && (
                <div className={styles.watermark} aria-hidden="true">
                  <span className={styles.watermarkText}>{decoration.watermark}</span>
                </div>
              )}
              {rulerDragAxis === "x" && (
                <>
                  <div className={styles.rulerGuide} style={{ left: `${padX}px`, top: 0, bottom: 0, width: "1px" }} aria-hidden="true" />
                  <div className={styles.rulerGuide} style={{ right: `${padX}px`, top: 0, bottom: 0, width: "1px" }} aria-hidden="true" />
                </>
              )}
              {rulerDragAxis === "y" && (
                <>
                  <div className={styles.rulerGuide} style={{ top: `${padY}px`, left: 0, right: 0, height: "1px" }} aria-hidden="true" />
                  <div className={styles.rulerGuide} style={{ bottom: `${padY}px`, left: 0, right: 0, height: "1px" }} aria-hidden="true" />
                </>
              )}
              <LiveDocHeaderFooter doc={doc} zone="header" readOnly={readOnly} />
              <EditorContent editor={editor} />
              <LiveDocHeaderFooter
                doc={doc}
                zone="footer"
                readOnly={readOnly}
                pageNumber={pageCount}
                pageCount={pageCount}
              />
              <LiveDocTableControls editor={editor} pageRef={pageRef} />
            </div>
          </div>
        </div>
        <div className={styles.pageCountBadge} aria-live="polite">
          {t("liveDoc.pageCount", { count: pageCount })}
        </div>
      </div>
        </>
        )}
      </div>
      <LiveDocDrawModal
        open={drawOpen}
        onClose={() => setDrawOpen(false)}
        onInsert={handleInsertDrawing}
      />
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
