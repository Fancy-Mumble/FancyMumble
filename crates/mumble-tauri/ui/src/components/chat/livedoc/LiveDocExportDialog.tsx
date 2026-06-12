/**
 * LiveDocExportDialog - "Export as Markdown" modal.
 *
 * Two destinations:
 *
 *  - **Save to disk**: Opens the OS native save-file dialog so the user
 *    can choose where to save the `.md` file.  File I/O is handled by
 *    the `save_markdown_file` Tauri command (`tauri-plugin-dialog`).
 *  - **Share in chat**: Hands off to the standard [`FileShareDialog`]
 *    so the user picks the access mode (public / password / session)
 *    and an optional message - the same flow as the chat composer's
 *    "Attach file" path.  We then upload the markdown to the file
 *    server with the chosen mode and post the resulting attachment
 *    marker as a chat message.
 *
 * Reuses the FileShareDialog CSS module for visual consistency.
 */

import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../../../store";
import {
  encodeFileAttachmentMarker,
  type FileAttachmentInfo,
} from "../file/FileAttachmentCard";
import type { FileShareChoice } from "../file/FileShareDialog";
import { Modal } from "../../elements/Modal";
import styles from "../file/FileShareDialog.module.css";

// Lazy like ChatView's usage: FileShareDialog is also dynamically imported
// there, and mixing static + dynamic imports of one module makes rolldown
// emit a cyclic chunk that crashes at evaluation time in release builds.
const FileShareDialog = lazy(() => import("../file/FileShareDialog"));

interface LiveDocExportDialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly channelId: number;
  readonly getMarkdown: () => string;
  readonly onClose: () => void;
}

/** Sub-phase within the export flow.
 *
 *  * `choose`        - main two-button picker (save to disk / share in chat)
 *  * `share-config`  - delegate to FileShareDialog so the user can pick
 *                      the access mode and (optionally) an attached message
 */
type Phase = "choose" | "share-config";

export default function LiveDocExportDialog({
  open,
  title,
  channelId,
  getMarkdown,
  onClose,
}: LiveDocExportDialogProps) {
  const { t } = useTranslation("chat");
  const { t: tc } = useTranslation("common");
  const fileServerConfig = useAppStore((s) => s.fileServerConfig);
  const sendMessage = useAppStore((s) => s.sendMessage);
  const [phase, setPhase] = useState<Phase>("choose");
  const [status, setStatus] = useState<"idle" | "saving" | "uploading" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPhase("choose");
    setStatus("idle");
    setError(null);
  }, [open]);

  const filename = useCallback(() => {
    const safe = title
      .toLowerCase()
      .replaceAll(/[^a-z0-9_-]+/g, "-")
      .replaceAll(/^-+|-+$/g, "")
      .slice(0, 64);
    return `${safe || "live-doc"}.md`;
  }, [title]);

  const handleSaveLocal = useCallback(async () => {
    setStatus("saving");
    setError(null);
    try {
      const md = getMarkdown();
      const saved = await invoke<string | null>("save_markdown_file", {
        content: md,
        defaultFilename: filename(),
      });
      if (saved === null) {
        setStatus("idle");
        return;
      }
      setStatus("done");
      setTimeout(onClose, 600);
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [getMarkdown, filename, onClose]);

  /** Switch to the share-config phase, which renders the standard
   *  FileShareDialog so the user can pick public / password / session
   *  and add an optional message - exactly the same dialog that the
   *  chat composer's "Attach file" button uses. */
  const handleOpenShare = useCallback(() => {
    if (!fileServerConfig) {
      setStatus("error");
      setError(t("liveDoc.export.fileServerUnavailable"));
      return;
    }
    setError(null);
    setStatus("idle");
    setPhase("share-config");
  }, [fileServerConfig, t]);

  const handleShareCancel = useCallback(() => {
    if (status === "uploading") return;
    setPhase("choose");
  }, [status]);

  /** Performs the actual upload with the access mode picked in the
   *  FileShareDialog.  Adds the optional message to the chat body
   *  alongside the attachment marker (matches the composer flow). */
  const handleShareSubmit = useCallback(
    async (choice: FileShareChoice) => {
      if (!fileServerConfig) return;
      setStatus("uploading");
      setError(null);
      try {
        const md = getMarkdown();
        const name = filename();
        const json = await invoke<{
          download_url: string;
          access_mode: "public" | "password" | "session";
          expires_at: number | null;
          size_bytes: number;
        }>("upload_bytes", {
          request: {
            baseUrl: fileServerConfig.baseUrl,
            session: fileServerConfig.sessionId,
            uploadToken: fileServerConfig.uploadToken,
            channelId,
            filename: name,
            mimeType: "text/markdown",
            content: md,
            mode: choice.mode,
            password: choice.password ?? null,
          },
        });
        const info: FileAttachmentInfo = {
          url: json.download_url,
          filename: name,
          sizeBytes: json.size_bytes,
          mode: json.access_mode,
          expiresAt: json.expires_at,
        };
        const marker = encodeFileAttachmentMarker(info);
        const body = choice.message ? `${choice.message}\n${marker}` : marker;
        await sendMessage(channelId, body);
        setStatus("done");
        setTimeout(onClose, 600);
      } catch (e) {
        setStatus("error");
        setError(e instanceof Error ? e.message : String(e));
        // Bounce the user back to the picker so they can retry or
        // pick a different destination.
        setPhase("choose");
      }
    },
    [fileServerConfig, getMarkdown, filename, channelId, sendMessage, onClose],
  );

  if (!open) return null;

  const busy = status === "saving" || status === "uploading";

  if (phase === "share-config") {
    return (
      <Suspense fallback={null}>
        <FileShareDialog
          open
          filename={filename()}
          canSharePublic={fileServerConfig?.canShareFilesPublic ?? true}
          onSubmit={handleShareSubmit}
          onCancel={handleShareCancel}
        />
      </Suspense>
    );
  }

  return (
    <Modal onClose={onClose} closeOnEsc={false} closeOnOverlayClick={false} zIndex={200} overlayClassName={styles.overlayBlur}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label={t("liveDoc.export.title")}>
        <div className={styles.header}>
          <h2 className={styles.title}>{t("liveDoc.export.title")}</h2>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label={tc("actions.close")}
            disabled={busy}
          >
            ×
          </button>
        </div>

        <div className={styles.body}>
          <p className={styles.message}>{t("liveDoc.export.prompt", { name: filename() })}</p>

          <div className={styles.modeList} role="radiogroup">
            <button
              type="button"
              className={`${styles.modeOption} ${status === "saving" ? styles.modeOptionActive : ""}`}
              onClick={handleSaveLocal}
              disabled={busy}
            >
              <div className={styles.modeText}>
                <div className={styles.modeName}>{t("liveDoc.export.saveLocalTitle")}</div>
                <div className={styles.modeDesc}>{t("liveDoc.export.saveLocalDesc")}</div>
              </div>
            </button>
            <button
              type="button"
              className={`${styles.modeOption} ${status === "uploading" ? styles.modeOptionActive : ""}`}
              onClick={handleOpenShare}
              disabled={busy || !fileServerConfig}
              title={!fileServerConfig ? t("liveDoc.export.fileServerUnavailable") : undefined}
            >
              <div className={styles.modeText}>
                <div className={styles.modeName}>{t("liveDoc.export.shareTitle")}</div>
                <div className={styles.modeDesc}>
                  {fileServerConfig
                    ? t("liveDoc.export.shareDesc")
                    : t("liveDoc.export.fileServerUnavailable")}
                </div>
              </div>
            </button>
          </div>

          {status === "done" && <p className={styles.message}>{t("liveDoc.export.done")}</p>}
          {status === "error" && error && (
            <p className={styles.message} role="alert">
              {t("liveDoc.export.failed", { detail: error })}
            </p>
          )}

          <div className={styles.actions}>
            <button type="button" className={styles.cancelBtn} onClick={onClose} disabled={busy}>
              {tc("actions.close")}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
