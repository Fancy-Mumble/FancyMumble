/**
 * LiveDocRibbon - the MS Word-style ribbon chrome for the Live Doc editor.
 *
 * Replaces both the old flat formatting toolbar and the document-action
 * header bar.  Renders a title bar (Quick Access save/undo/redo + document
 * title/status/peers + window controls), a tab strip (File backstage menu +
 * Home/Insert/Draw/Design/Layout/References/Review/View), and the active
 * tab's panel of grouped controls.
 *
 * It lives inside `LiveDocEditor`'s render so it re-renders on every editor
 * transaction - that keeps formatting active-states (bold on/off, current
 * heading, etc.) reactive for free, exactly as the previous toolbar did.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { Editor } from "@tiptap/react";
import type * as Y from "yjs";
import {
  CloseIcon,
  EditIcon,
  FileDownIcon,
  FileIcon,
  GlobeIcon,
  HistoryIcon,
  MaximizeIcon,
  MinimizeIcon,
  PrinterIcon,
  RedoIcon,
  SaveIcon,
  StarIcon,
  UndoIcon,
  UsersGroupIcon,
} from "../../../icons";
import type { LiveDocPeer } from "./useLiveDoc";
import type { LiveDocSharedMember } from "../../../types";
import LiveDocAvatarStack from "./LiveDocAvatarStack";
import {
  HomeTab,
  InsertTab,
  DrawTab,
  DesignTab,
  LayoutTab,
  ReferencesTab,
  ReviewTab,
  ViewTab,
} from "./LiveDocRibbonTabs";
import styles from "./LiveDocRibbon.module.css";

/** i18n keys for the connection-status pill. */
export type LiveDocStatusKey =
  | "liveDoc.connected"
  | "liveDoc.connecting"
  | "liveDoc.disconnected";

/** Document + window actions surfaced by the ribbon, supplied by the panel. */
export interface LiveDocChrome {
  readonly title: string;
  /** i18n key for the connection-status pill. */
  readonly statusKey: LiveDocStatusKey;
  readonly connected: boolean;
  readonly peers: ReadonlyArray<LiveDocPeer>;
  readonly sharedWith?: ReadonlyArray<LiveDocSharedMember>;
  readonly isOwner: boolean;
  readonly savedFlash: boolean;
  readonly onRename: () => void;
  readonly onSaveNow: () => void;
  readonly onExport: () => void;
  readonly onExportPdf: () => void;
  readonly onHistory: () => void;
  readonly onSaveToDocs: () => void;
  readonly onPublish: () => void;
  readonly compactChat: boolean;
  readonly onToggleCompactChat?: () => void;
  readonly onClose: () => void;
}

type RibbonTab =
  | "home"
  | "insert"
  | "draw"
  | "design"
  | "layout"
  | "references"
  | "review"
  | "view";

const TABS: ReadonlyArray<{ readonly id: RibbonTab; readonly key: string; readonly fallback: string }> = [
  { id: "home", key: "liveDoc.ribbon.tabs.home", fallback: "Home" },
  { id: "insert", key: "liveDoc.ribbon.tabs.insert", fallback: "Insert" },
  { id: "draw", key: "liveDoc.ribbon.tabs.draw", fallback: "Draw" },
  { id: "design", key: "liveDoc.ribbon.tabs.design", fallback: "Design" },
  { id: "layout", key: "liveDoc.ribbon.tabs.layout", fallback: "Layout" },
  { id: "references", key: "liveDoc.ribbon.tabs.references", fallback: "References" },
  { id: "review", key: "liveDoc.ribbon.tabs.review", fallback: "Review" },
  { id: "view", key: "liveDoc.ribbon.tabs.view", fallback: "View" },
];

interface LiveDocRibbonProps {
  readonly editor: Editor;
  readonly doc: Y.Doc;
  readonly chrome: LiveDocChrome;
  readonly pageCount: number;
  readonly outlineOpen: boolean;
  readonly onToggleOutline: () => void;
  readonly paperMode: boolean;
  readonly onTogglePaperMode: () => void;
  readonly markdownMode: boolean;
  readonly onToggleMarkdown: () => void;
  readonly onInsertCoverPage: () => void;
  readonly onInsertSectionBreak: () => void;
  readonly onInsertMathBlock: () => void;
  readonly onOpenDraw: () => void;
}

export default function LiveDocRibbon(props: LiveDocRibbonProps) {
  const { editor, doc, chrome, pageCount } = props;
  const { t } = useTranslation("chat");
  const [activeTab, setActiveTab] = useState<RibbonTab>("home");

  return (
    <div className={styles.ribbon}>
      <TitleBar chrome={chrome} editor={editor} />

      <div className={styles.tabStrip} role="tablist">
        <FileMenu chrome={chrome} />
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`${styles.tab} ${activeTab === tab.id ? styles.tabActive : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {t(tab.key, { defaultValue: tab.fallback })}
          </button>
        ))}
      </div>

      <div className={styles.panel} role="tabpanel">
        {activeTab === "home" && <HomeTab editor={editor} />}
        {activeTab === "insert" && (
          <InsertTab
            editor={editor}
            onInsertCoverPage={props.onInsertCoverPage}
            onInsertMathBlock={props.onInsertMathBlock}
          />
        )}
        {activeTab === "draw" && <DrawTab onOpenDraw={props.onOpenDraw} />}
        {activeTab === "design" && <DesignTab doc={doc} />}
        {activeTab === "layout" && (
          <LayoutTab doc={doc} onInsertSectionBreak={props.onInsertSectionBreak} />
        )}
        {activeTab === "references" && <ReferencesTab editor={editor} doc={doc} />}
        {activeTab === "review" && <ReviewTab editor={editor} pageCount={pageCount} />}
        {activeTab === "view" && (
          <ViewTab
            outlineOpen={props.outlineOpen}
            onToggleOutline={props.onToggleOutline}
            paperMode={props.paperMode}
            onTogglePaperMode={props.onTogglePaperMode}
            markdownMode={props.markdownMode}
            onToggleMarkdown={props.onToggleMarkdown}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Title bar: quick-access toolbar + title/status + window controls
// ---------------------------------------------------------------------------

function TitleBar({ chrome, editor }: { readonly chrome: LiveDocChrome; readonly editor: Editor }) {
  const { t } = useTranslation("chat");
  return (
    <div className={styles.titleBar}>
      <div className={styles.qat}>
        <button
          type="button"
          className={`${styles.qatBtn} ${chrome.savedFlash ? styles.qatActive : ""}`}
          onClick={chrome.onSaveNow}
          title={chrome.savedFlash ? t("liveDoc.saved") : t("liveDoc.saveNow")}
          aria-label={chrome.savedFlash ? t("liveDoc.saved") : t("liveDoc.saveNow")}
        >
          <SaveIcon width={15} height={15} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={styles.qatBtn}
          onClick={() => editor.chain().focus().undo().run()}
          title={t("liveDoc.toolbar.undo")}
          aria-label={t("liveDoc.toolbar.undo")}
        >
          <UndoIcon width={15} height={15} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={styles.qatBtn}
          onClick={() => editor.chain().focus().redo().run()}
          title={t("liveDoc.toolbar.redo")}
          aria-label={t("liveDoc.toolbar.redo")}
        >
          <RedoIcon width={15} height={15} aria-hidden="true" />
        </button>
      </div>

      <div className={styles.titleArea}>
        <FileIcon width={15} height={15} aria-hidden="true" />
        <span className={styles.titleText}>{chrome.title}</span>
        <span
          className={`${styles.status} ${chrome.connected ? styles.statusOk : styles.statusBad}`}
          aria-live="polite"
        >
          {t(chrome.statusKey)}
        </span>
        {chrome.peers.length > 0 && <LiveDocAvatarStack peers={chrome.peers} />}
        {chrome.sharedWith && chrome.sharedWith.length > 0 && (
          <span
            className={styles.sharedWith}
            title={chrome.sharedWith.map((m) => m.display_name).join(", ")}
          >
            <UsersGroupIcon width={13} height={13} aria-hidden="true" />
            {chrome.sharedWith.length}
          </span>
        )}
      </div>

      <div className={styles.windowControls}>
        {chrome.onToggleCompactChat && (
          <button
            type="button"
            className={`${styles.winBtn} ${chrome.compactChat ? styles.winBtnActive : ""}`}
            onClick={chrome.onToggleCompactChat}
            title={chrome.compactChat ? t("liveDoc.compactChatOff") : t("liveDoc.compactChatOn")}
            aria-label={chrome.compactChat ? t("liveDoc.compactChatOff") : t("liveDoc.compactChatOn")}
            aria-pressed={chrome.compactChat}
          >
            {chrome.compactChat ? <MaximizeIcon width={14} height={14} /> : <MinimizeIcon width={14} height={14} />}
          </button>
        )}
        <button
          type="button"
          className={`${styles.winBtn} ${styles.winBtnClose}`}
          onClick={chrome.onClose}
          title={t("liveDoc.closePanel")}
          aria-label={t("liveDoc.closePanel")}
        >
          <CloseIcon width={15} height={15} />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// File backstage menu
// ---------------------------------------------------------------------------

function FileMenu({ chrome }: { readonly chrome: LiveDocChrome }) {
  const { t } = useTranslation("chat");
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const run = (fn: () => void) => () => {
    fn();
    setOpen(false);
  };

  const handleToggle = () => {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setMenuPos({ left: rect.left, top: rect.bottom + 2 });
    }
    setOpen((v) => !v);
  };

  return (
    <div className={styles.fileMenuWrap}>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.tab} ${styles.fileTab}`}
        onClick={handleToggle}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {t("liveDoc.ribbon.tabs.file", { defaultValue: "File" })}
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className={styles.fileMenu}
            style={{ position: "fixed", left: menuPos.left, top: menuPos.top, zIndex: 9999 }}
            role="menu"
          >
            <button type="button" role="menuitem" className={styles.fileMenuItem} onClick={run(chrome.onRename)}>
              <EditIcon width={16} height={16} aria-hidden="true" />
              {t("liveDoc.renameDoc")}
            </button>
            {chrome.isOwner && (
              <button type="button" role="menuitem" className={styles.fileMenuItem} onClick={run(chrome.onSaveNow)}>
                <SaveIcon width={16} height={16} aria-hidden="true" />
                {t("liveDoc.saveNow")}
              </button>
            )}
            <div className={styles.fileMenuSep} />
            <button type="button" role="menuitem" className={styles.fileMenuItem} onClick={run(chrome.onExport)}>
              <FileDownIcon width={16} height={16} aria-hidden="true" />
              {t("liveDoc.exportMarkdown")}
            </button>
            <button type="button" role="menuitem" className={styles.fileMenuItem} onClick={run(chrome.onExportPdf)}>
              <PrinterIcon width={16} height={16} aria-hidden="true" />
              {t("liveDoc.exportPdf")}
            </button>
            <div className={styles.fileMenuSep} />
            <button type="button" role="menuitem" className={styles.fileMenuItem} onClick={run(chrome.onSaveToDocs)}>
              <StarIcon width={16} height={16} aria-hidden="true" />
              {t("liveDoc.sidebar.saveToDocs")}
            </button>
            <button type="button" role="menuitem" className={styles.fileMenuItem} onClick={run(chrome.onPublish)}>
              <GlobeIcon width={16} height={16} aria-hidden="true" />
              {t("liveDoc.publishToChannel")}
            </button>
            <button type="button" role="menuitem" className={styles.fileMenuItem} onClick={run(chrome.onHistory)}>
              <HistoryIcon width={16} height={16} aria-hidden="true" />
              {t("liveDoc.history")}
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}
