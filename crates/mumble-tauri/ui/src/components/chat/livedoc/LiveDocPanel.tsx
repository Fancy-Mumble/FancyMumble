/**
 * LiveDocPanel - chat-top-half container that hosts a collaborative
 * document.  Mirrors the pattern used by ScreenShareViewer so the
 * chat composer always stays at the bottom of the screen.
 *
 * Mounted whenever the store has an `activeLiveDoc` entry for the
 * current channel; otherwise the panel is not rendered and the chat
 * shows full-height as usual.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CloseIcon,
  FileDownIcon,
  FileIcon,
  HistoryIcon,
  MaximizeIcon,
  MinimizeIcon,
  NewspaperIcon,
  PrinterIcon,
  ShareIcon,
} from "../../../icons";
import { useAppStore, encodeLiveDocInviteMarker, sendPluginMessage } from "../../../store";
import { useLiveDoc, type LiveDocSessionInfo } from "./useLiveDoc";
import LiveDocEditor, { type LiveDocEditorApi } from "./LiveDocEditor";
import LiveDocAvatarStack from "./LiveDocAvatarStack";
import LiveDocExportDialog from "./LiveDocExportDialog";
import { exportLiveDocToPdf } from "./liveDocPdf";
import styles from "./LiveDocPanel.module.css";

interface LiveDocPanelProps {
  readonly session: LiveDocSessionInfo;
  /** When true, the chat below is shrunk to ~25 % of the viewport. */
  readonly compactChat?: boolean;
  readonly onToggleCompactChat?: () => void;
}

export default function LiveDocPanel({
  session,
  compactChat = false,
  onToggleCompactChat,
}: LiveDocPanelProps) {
  const { t } = useTranslation("chat");
  const closeActiveLiveDoc = useAppStore((s) => s.closeActiveLiveDoc);
  const consumePendingLiveDocSeed = useAppStore((s) => s.consumePendingLiveDocSeed);
  const sendMessage = useAppStore((s) => s.sendMessage);
  const storeUsers = useAppStore((s) => s.users);
  const activeSessions = useMemo(() => new Set(storeUsers.map((u) => u.session)), [storeUsers]);
  const handle = useLiveDoc(session);
  const editorApi = useRef<LiveDocEditorApi | null>(null);
  const [paperMode, setPaperMode] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  // Only show peers who are still present on the Mumble server.  Yjs
  // awareness states expire after ~30 s, so without this filter a
  // disconnected user's avatar lingers until the timeout fires.
  const rawPeers = handle?.peers ?? [];
  const peers = rawPeers.filter((p) => p.isLocal || activeSessions.has(p.session));

  const onClose = useCallback(() => {
    closeActiveLiveDoc(session.channelId, session.appServerId);
  }, [session.channelId, session.appServerId, closeActiveLiveDoc]);

  const onHistory = useCallback(() => {
    // eslint-disable-next-line no-alert
    window.alert(t("liveDoc.historyComingSoon"));
  }, [t]);

  const onReshareInvite = useCallback(() => {
    sendPluginMessage("fancy-live-doc", "Announce", {
      channelId: session.channelId,
      slug: session.slug,
      title: session.title,
    }).catch((e) => console.warn("plugin-message Announce failed:", e));
    const body = encodeLiveDocInviteMarker(session.slug, session.title);
    void sendMessage(session.channelId, body).catch((e) =>
      console.warn("live-doc reshare message failed:", e),
    );
  }, [session.channelId, session.slug, session.title, sendMessage]);

  const onExport = useCallback(() => setExportOpen(true), []);
  const getMarkdownForExport = useCallback(
    () => editorApi.current?.getMarkdown() ?? "",
    [],
  );

  const onExportPdf = useCallback(() => {
    const html = editorApi.current?.getHtml() ?? "";
    if (!html) return;
    void exportLiveDocToPdf(html, session.title || t("liveDoc.untitled"))
      .catch((e) => console.warn("live-doc pdf export failed:", e));
  }, [session.title, t]);

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

  const statusKey = handle?.status === "connected"
    ? "liveDoc.connected"
    : handle?.status === "connecting"
      ? "liveDoc.connecting"
      : "liveDoc.disconnected";

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.title}>
          <FileIcon width={16} height={16} aria-hidden="true" />
          <span className={styles.titleText}>{session.title || t("liveDoc.untitled")}</span>
          <span
            className={`${styles.status} ${handle?.status === "connected" ? styles.statusOk : styles.statusBad}`}
            aria-live="polite"
          >
            {t(statusKey)}
          </span>
          {peers.length > 0 && <LiveDocAvatarStack peers={peers} />}
        </div>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={`${styles.headerIconBtn} ${paperMode ? styles.headerBtnActive : ""}`}
            onClick={() => setPaperMode((v) => !v)}
            title={paperMode ? t("liveDoc.paperModeOff") : t("liveDoc.paperModeOn")}
            aria-label={paperMode ? t("liveDoc.paperModeOff") : t("liveDoc.paperModeOn")}
            aria-pressed={paperMode}
          >
            <NewspaperIcon width={16} height={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={styles.headerIconBtn}
            onClick={onExport}
            title={t("liveDoc.exportMarkdown")}
            aria-label={t("liveDoc.exportMarkdown")}
          >
            <FileDownIcon width={16} height={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={styles.headerIconBtn}
            onClick={onExportPdf}
            title={t("liveDoc.exportPdf")}
            aria-label={t("liveDoc.exportPdf")}
          >
            <PrinterIcon width={16} height={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={styles.headerIconBtn}
            onClick={onHistory}
            title={t("liveDoc.history")}
            aria-label={t("liveDoc.history")}
          >
            <HistoryIcon width={16} height={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={styles.headerIconBtn}
            onClick={onReshareInvite}
            title={t("liveDoc.reshareInvite")}
            aria-label={t("liveDoc.reshareInvite")}
          >
            <ShareIcon width={16} height={16} aria-hidden="true" />
          </button>
          {onToggleCompactChat && (
            <button
              type="button"
              className={`${styles.headerBtnClose} ${compactChat ? styles.headerBtnActive : ""}`}
              onClick={onToggleCompactChat}
              title={compactChat ? t("liveDoc.compactChatOff") : t("liveDoc.compactChatOn")}
              aria-label={compactChat ? t("liveDoc.compactChatOff") : t("liveDoc.compactChatOn")}
              aria-pressed={compactChat}
            >
              {compactChat ? (
                <MaximizeIcon width={14} height={14} />
              ) : (
                <MinimizeIcon width={14} height={14} />
              )}
            </button>
          )}
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
      <div className={styles.body}>
        {handle ? (
          <>
            <LiveDocEditor
              doc={handle.doc}
              provider={handle.provider}
              paperMode={paperMode}
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
      </div>

      <LiveDocExportDialog
        open={exportOpen}
        title={session.title || t("liveDoc.untitled")}
        channelId={session.channelId}
        getMarkdown={getMarkdownForExport}
        onClose={() => setExportOpen(false)}
      />
    </div>
  );
}
