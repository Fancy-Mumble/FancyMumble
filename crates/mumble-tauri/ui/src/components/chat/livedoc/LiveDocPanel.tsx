/**
 * LiveDocPanel - chat-top-half container that hosts a collaborative
 * document.  Mirrors the pattern used by ScreenShareViewer so the
 * chat composer always stays at the bottom of the screen.
 *
 * Mounted whenever the store has an `activeLiveDoc` entry for the
 * current channel; otherwise the panel is not rendered and the chat
 * shows full-height as usual.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CloseIcon, FileIcon } from "../../../icons";
import { useAppStore, encodeLiveDocInviteMarker, sendPluginMessage } from "../../../store";
import {
  useLiveDoc,
  useLiveDocTitle,
  useLiveDocPageSetup,
  useLiveDocDecoration,
  setLiveDocTitle,
  type LiveDocSessionInfo,
} from "./useLiveDoc";
import LiveDocEditor, { type LiveDocEditorApi } from "./LiveDocEditor";
import type { LiveDocChrome } from "./LiveDocRibbon";
import LiveDocExportDialog from "./LiveDocExportDialog";
import LiveDocSidebar from "./LiveDocSidebar";
import { useLiveDocSidebarStore } from "./sidebarStore";
import { useLiveDocDropStore } from "./liveDocDropStore";
import { useLiveDocSharedWithStore } from "./sharedWithStore";
import { exportLiveDocToPdf } from "./liveDocPdf";
import { resetCiteprocCache } from "./liveDocCiteproc";
import { openPrompt } from "../../elements/promptDialogStore";
import type { LiveDocDocLink } from "../../../types";
import styles from "./LiveDocPanel.module.css";

interface LiveDocPanelProps {
  readonly session: LiveDocSessionInfo;
  /** When true, the chat below is shrunk to ~25 % of the viewport. */
  readonly compactChat?: boolean;
  readonly onToggleCompactChat?: () => void;
  /** Invoked when the user picks "New document" from the sidebar. */
  readonly onCreateDoc?: () => void;
  /** Invoked when the user picks "New document" on a specific sidebar
   *  folder/section, so the created doc is filed under it. */
  readonly onCreateDocInFolder?: (folderId: string) => void;
}

export default function LiveDocPanel({
  session,
  compactChat = false,
  onToggleCompactChat,
  onCreateDoc,
  onCreateDocInFolder,
}: LiveDocPanelProps) {
  const { t } = useTranslation("chat");
  const closeActiveLiveDoc = useAppStore((s) => s.closeActiveLiveDoc);
  const consumePendingLiveDocSeed = useAppStore((s) => s.consumePendingLiveDocSeed);
  const sendMessage = useAppStore((s) => s.sendMessage);
  const publishLiveDoc = useAppStore((s) => s.publishLiveDoc);
  const requestOpenLiveDoc = useAppStore((s) => s.requestOpenLiveDoc);
  const renameActiveLiveDoc = useAppStore((s) => s.renameActiveLiveDoc);
  const saveLiveDoc = useAppStore((s) => s.saveLiveDoc);
  const storeUsers = useAppStore((s) => s.users);
  const activeSessions = useMemo(() => new Set(storeUsers.map((u) => u.session)), [storeUsers]);
  const saveDocToDefault = useLiveDocSidebarStore((s) => s.saveDocToDefault);
  const renameDocLink = useLiveDocSidebarStore((s) => s.renameDocLink);
  const sharedWith = useLiveDocSharedWithStore((s) => s.bySlug[session.slug]);
  const handle = useLiveDoc(session);
  const liveTitle = useLiveDocTitle(handle?.doc ?? null, session.title || t("liveDoc.untitled"));
  const pageSetup = useLiveDocPageSetup(handle?.doc ?? null);
  const decoration = useLiveDocDecoration(handle?.doc ?? null);
  const editorApi = useRef<LiveDocEditorApi | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const dragOver = useLiveDocDropStore((s) => s.dragOver);
  const [exportOpen, setExportOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  // Only show peers who are still present on the Mumble server.  Yjs
  // awareness states expire after ~30 s, so without this filter a
  // disconnected user's avatar lingers until the timeout fires.
  const rawPeers = handle?.peers ?? [];
  const peers = rawPeers.filter((p) => p.isLocal || activeSessions.has(p.session));

  const onClose = useCallback(() => {
    closeActiveLiveDoc(session.channelId, session.appServerId);
  }, [session.channelId, session.appServerId, closeActiveLiveDoc]);

  const onHistory = useCallback(() => {
    globalThis.alert(t("liveDoc.historyComingSoon"));
  }, [t]);

  // Publish the document to the current channel: tell the server to bind
  // it (so channel members may join), announce to peers, and post a
  // persistent invite card.  Also used to re-share an already-published
  // doc.  This replaces the old "Re-share invite" action.
  const onPublish = useCallback(() => {
    void publishLiveDoc(session.channelId, session.slug).catch((e) =>
      console.warn("live-doc publish failed:", e),
    );
    sendPluginMessage("fancy-live-doc", "Announce", {
      channelId: session.channelId,
      slug: session.slug,
      title: session.title,
    }).catch((e) => console.warn("plugin-message Announce failed:", e));
    const body = encodeLiveDocInviteMarker(session.slug, session.title);
    void sendMessage(session.channelId, body).catch((e) =>
      console.warn("live-doc publish message failed:", e),
    );
  }, [publishLiveDoc, session.channelId, session.slug, session.title, sendMessage]);

  const onSaveToDocs = useCallback(() => {
    const link: LiveDocDocLink = {
      slug: session.slug,
      title: session.title || t("liveDoc.untitled"),
      channel: session.channelId || null,
      owned: false,
    };
    saveDocToDefault(link, t("liveDoc.sidebar.defaultSection"));
  }, [saveDocToDefault, session.slug, session.title, session.channelId, t]);

  const applyActiveRename = useCallback(
    (slug: string, title: string) => {
      if (handle?.doc) setLiveDocTitle(handle.doc, title);
      renameActiveLiveDoc(session.channelId, slug, title, session.appServerId);
    },
    [handle, renameActiveLiveDoc, session.channelId, session.appServerId],
  );

  const onRename = useCallback(() => {
    void openPrompt({
      title: t("liveDoc.renameDoc"),
      label: t("liveDoc.renameDocPrompt"),
      defaultValue: liveTitle,
    }).then((next) => {
      const title = next?.trim();
      if (!title || title === liveTitle) return;
      applyActiveRename(session.slug, title);
      renameDocLink(session.slug, title);
    });
  }, [t, liveTitle, applyActiveRename, renameDocLink, session.slug]);

  const onSaveNow = useCallback(() => {
    void saveLiveDoc(session.channelId, session.slug)
      .then(() => {
        setSavedFlash(true);
        globalThis.setTimeout(() => setSavedFlash(false), 1500);
      })
      .catch((e) => console.warn("live-doc save failed:", e));
  }, [saveLiveDoc, session.channelId, session.slug]);

  const onOpenSidebarDoc = useCallback(
    (link: LiveDocDocLink) => {
      const channelId = link.channel ?? session.channelId;
      const mode = link.channel === null ? "private" : "publish";
      void requestOpenLiveDoc(channelId, link.slug, link.title, { silent: true, mode }).catch(
        (e) => console.warn("live-doc open from sidebar failed:", e),
      );
    },
    [requestOpenLiveDoc, session.channelId],
  );

  const onExport = useCallback(() => setExportOpen(true), []);
  const getMarkdownForExport = useCallback(
    () => editorApi.current?.getMarkdown() ?? "",
    [],
  );

  const onExportPdf = useCallback(() => {
    const html = editorApi.current?.getHtml() ?? "";
    if (!html) return;
    void exportLiveDocToPdf(html, liveTitle, pageSetup, decoration)
      .catch((e) => console.warn("live-doc pdf export failed:", e));
  }, [liveTitle, pageSetup, decoration]);

  const onEditorReady = useCallback(
    (api: LiveDocEditorApi) => {
      editorApi.current = api;
      const seed = consumePendingLiveDocSeed(session.channelId, session.appServerId);
      if (seed !== undefined) {
        api.setMarkdown(seed);
      }
    },
    [consumePendingLiveDocSeed, session.channelId, session.appServerId],
  );

  useEffect(() => {
    const { registerTarget, unregisterTarget } = useLiveDocDropStore.getState();
    registerTarget(
      () => bodyRef.current?.getBoundingClientRect() ?? null,
      (files) => {
        for (const file of files) {
          void editorApi.current
            ?.insertImageFromFile(file)
            .catch((e) => console.warn("live-doc image drop failed:", e));
        }
      },
    );
    return () => unregisterTarget();
  }, []);

  useEffect(() => {
    return () => {
      resetCiteprocCache();
    };
  }, []);

  let statusKey: "liveDoc.connected" | "liveDoc.connecting" | "liveDoc.disconnected" =
    "liveDoc.disconnected";
  if (handle?.status === "connected") {
    statusKey = "liveDoc.connected";
  } else if (handle?.status === "connecting") {
    statusKey = "liveDoc.connecting";
  }

  // All document + window actions are surfaced by the ribbon (title bar +
  // File backstage menu) inside the editor; bundle them into one object.
  const chrome: LiveDocChrome = {
    title: liveTitle,
    statusKey,
    connected: handle?.status === "connected",
    peers,
    sharedWith,
    isOwner: session.isOwner ?? false,
    savedFlash,
    onRename,
    onSaveNow,
    onExport,
    onExportPdf,
    onHistory,
    onSaveToDocs,
    onPublish,
    compactChat,
    onToggleCompactChat,
    onClose,
  };

  return (
    <div className={styles.panel}>
      <div className={styles.split}>
        <LiveDocSidebar
          currentSlug={session.slug}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => setSidebarCollapsed((v) => !v)}
          onOpenDoc={onOpenSidebarDoc}
          onCreateDoc={onCreateDoc}
          onCreateDocInFolder={onCreateDocInFolder}
          onRenameActiveDoc={applyActiveRename}
        />
        <div className={styles.main}>
      {/* Document chrome (title, status, all actions) now lives in the
          ribbon inside the editor.  While still connecting there is no
          editor yet, so show a slim fallback bar with the title + close. */}
      {!handle && (
        <div className={styles.header}>
          <div className={styles.title}>
            <FileIcon width={16} height={16} aria-hidden="true" />
            <span className={styles.titleText}>{liveTitle}</span>
            <span className={`${styles.status} ${styles.statusBad}`} aria-live="polite">
              {t(statusKey)}
            </span>
          </div>
          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.headerBtnClose}
              onClick={onClose}
              title={t("liveDoc.closePanel")}
              aria-label={t("liveDoc.closePanel")}
            >
              <CloseIcon width={16} height={16} />
            </button>
          </div>
        </div>
      )}
      <div className={styles.body} ref={bodyRef}>
        {handle ? (
          <>
            <LiveDocEditor
              doc={handle.doc}
              provider={handle.provider}
              chrome={chrome}
              onReady={onEditorReady}
            />
            {handle.error && (
              <div className={styles.errorOverlay} role="alert">
                <div className={styles.errorOverlayContent}>
                  <p className={styles.errorOverlayTitle}>{t("liveDoc.connectionLost")}</p>
                  <p className={styles.errorOverlayMessage}>{handle.error}</p>
                  <div className={styles.errorOverlayActions}>
                    <button
                      type="button"
                      className={styles.errorActionBtnPrimary}
                      onClick={onExport}
                    >
                      {t("liveDoc.saveLastDocument")}
                    </button>
                    <button
                      type="button"
                      className={styles.errorActionBtnSecondary}
                      onClick={onClose}
                    >
                      {t("liveDoc.quitDocument")}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className={styles.loading}>{t("liveDoc.connecting")}</div>
        )}
        {dragOver && (
          <div className={styles.dropOverlay} aria-hidden="true">
            <div className={styles.dropOverlayInner}>
              <span>{t("liveDoc.dropImageHint")}</span>
            </div>
          </div>
        )}
      </div>
        </div>
      </div>

      <LiveDocExportDialog
        open={exportOpen}
        title={liveTitle}
        channelId={session.channelId}
        getMarkdown={getMarkdownForExport}
        onClose={() => setExportOpen(false)}
      />
    </div>
  );
}
