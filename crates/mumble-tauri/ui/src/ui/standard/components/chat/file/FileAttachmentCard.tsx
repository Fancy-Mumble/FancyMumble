import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { convertFileSrc } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useAppStore } from "@core/store";
import { previewKindForFilename, type FileAttachmentInfo } from "@core/features/chat/fileAttachments";
import { formatBytes } from "@core/utils/format";
import { MediaLightbox } from "../media/MediaPreview";
import { FilePasswordDialog } from "./FilePasswordDialog";
import styles from "./FileAttachmentCard.module.css";

export type { FileAttachmentInfo, PreviewKind } from "@core/features/chat/fileAttachments";
export {
  decodeFileAttachmentPayload,
  encodeFileAttachmentMarker,
  FANCY_FILE_MARKER_RE,
  previewKindForFilename,
} from "@core/features/chat/fileAttachments";

interface FileAttachmentCardProps {
  readonly info: FileAttachmentInfo;
}

/** HTML-comment marker used to embed a file attachment in a chat message
 *  body. Renderers detect the marker and render a {@link FileAttachmentCard}
 *  in place of the raw markdown link. Legacy clients see the inert comment. */
export default function FileAttachmentCard({ info }: FileAttachmentCardProps) {
  const { t } = useTranslation("chat");
  const downloadFile = useAppStore((s) => s.downloadFile);
  const addDownload = useAppStore((s) => s.addDownload);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  // Native password prompt (replaces window.prompt): the open flag drives the
  // dialog and a stored resolver hands the entered value back to `onSave`.
  const [pwPromptOpen, setPwPromptOpen] = useState(false);
  const pwResolverRef = useRef<((value: string | null) => void) | null>(null);
  const initiallyExpired = info.expiresAt != null && info.expiresAt > 0 && info.expiresAt * 1000 < Date.now();
  const [expired, setExpired] = useState<boolean>(initiallyExpired);

  const kind = previewKindForFilename(info.filename);
  const previewable = kind === "image" || kind === "audio" || kind === "video";

  // Post-download: local asset URL (works for any access mode).
  // Pre-download: public files only - URL is a signed but open link.
  const previewSrc = savedPath
    ? convertFileSrc(savedPath)
    : info.mode === "public" && previewable
      ? info.url
      : null;

  const handleOpenInBrowser = useCallback(() => {
    openUrl(info.url).catch(() => {
      // Fallback for non-Tauri environments (e.g. Vite dev server) or when
      // the opener plugin call fails for any reason.
      window.open(info.url, "_blank", "noopener,noreferrer");
    });
  }, [info.url]);

  const handleImageClick = useCallback(() => {
    if (previewSrc) setLightboxOpen(true);
  }, [previewSrc]);

  const closeLightbox = useCallback(() => setLightboxOpen(false), []);

  // Switch to expired state automatically once the announced expiry
  // timestamp passes, without waiting for a network failure.
  useEffect(() => {
    if (savedPath || expired) return;
    if (info.expiresAt == null || info.expiresAt <= 0) return;
    const msUntilExpiry = info.expiresAt * 1000 - Date.now();
    if (msUntilExpiry <= 0) {
      setExpired(true);
      return;
    }
    const timer = globalThis.setTimeout(() => setExpired(true), msUntilExpiry + 500);
    return () => globalThis.clearTimeout(timer);
  }, [info.expiresAt, savedPath, expired]);

  // Probe the URL when an inline preview fails to load. The file-server
  // returns HTTP 404 with a JSON body of `{"error":"link expired"}` for
  // expired signed URLs - distinguish that from a generic load failure.
  const probeForExpiry = useCallback(async () => {
    try {
      const resp = await fetch(info.url, { method: "GET" });
      if (resp.status === 404) {
        let body = "";
        try {
          body = await resp.text();
        } catch {
          // ignore body parse failure
        }
        if (body.toLowerCase().includes("expired")) {
          setExpired(true);
          return;
        }
      }
      setError("Preview failed to load.");
    } catch {
      setError("Preview failed to load.");
    }
  }, [info.url]);

  const handlePreviewError = useCallback(() => {
    if (expired) return;
    void probeForExpiry();
  }, [expired, probeForExpiry]);

  const canOpenInBrowser = (info.mode === "public" || info.mode === "password") && !expired;

  // Open the native password dialog and resolve with the entered value (or
  // null if cancelled).
  const askPassword = useCallback(
    () =>
      new Promise<string | null>((resolve) => {
        pwResolverRef.current = resolve;
        setPwPromptOpen(true);
      }),
    [],
  );

  const resolvePassword = useCallback((value: string | null) => {
    setPwPromptOpen(false);
    const resolve = pwResolverRef.current;
    pwResolverRef.current = null;
    resolve?.(value);
  }, []);

  const onSave = useCallback(async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const dest = await save({ defaultPath: info.filename });
      if (!dest) {
        setBusy(false);
        return;
      }
      let password: string | undefined;
      if (info.mode === "password") {
        const entered = await askPassword();
        if (entered === null) {
          setBusy(false);
          return;
        }
        password = entered;
      }
      const written = await downloadFile({ url: info.url, destPath: dest, password });
      addDownload({
        filename: info.filename,
        destPath: dest,
        sizeBytes: written,
        sourceUrl: info.url,
        mode: info.mode,
      });
      setSaved(true);
      setSavedPath(dest);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.toLowerCase().includes("expired")) {
        setExpired(true);
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  }, [downloadFile, addDownload, info, askPassword]);

  const preview = (() => {
    if (!previewSrc) return null;
    if (kind === "image") {
      return (
        <button
          type="button"
          className={styles.previewImageBtn}
          onClick={handleImageClick}
          aria-label={t("fileAttachment.viewInLightbox", { filename: info.filename })}
        >
          <img
            src={previewSrc}
            alt={info.filename}
            className={styles.previewImage}
            loading="lazy"
            onError={handlePreviewError}
          />
        </button>
      );
    }
    if (kind === "audio") {
      return (
        <div className={styles.previewAudioWrap}>
          <audio
            controls
            preload="none"
            src={previewSrc}
            className={styles.previewAudio}
            onError={handlePreviewError}
          >
            <track kind="captions" />
          </audio>
        </div>
      );
    }
    if (kind === "video") {
      return (
        <video
          controls
          preload="metadata"
          src={previewSrc}
          className={styles.previewVideo}
          onError={handlePreviewError}
        >
          <track kind="captions" />
        </video>
      );
    }
    return null;
  })();

  if (expired) {
    return (
      <div className={`${styles.card} ${styles.expiredCard}`}>
        <div className={styles.cardRow}>
          <div className={`${styles.icon} ${styles.expiredIcon}`} aria-hidden="true">
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="9" />
              <polyline points="12 7 12 12 15 14" />
            </svg>
          </div>
          <div className={styles.body}>
            <div className={styles.filename}>{info.filename}</div>
            <div className={styles.expiredMessage}>{t("fileAttachment.expired")}</div>
            <div className={styles.meta}>
              {formatBytes(info.sizeBytes)}
              {info.mode !== "public" && <span className={styles.badge}>{info.mode}</span>}
              {info.expiresAt != null && info.expiresAt > 0 && (
                <span className={styles.expiry}>
                  {t("fileAttachment.expiredPrefix")} {new Date(info.expiresAt * 1000).toLocaleString()}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.card}>
      {preview}
      <div className={styles.cardRow}>
        <div className={styles.icon} aria-hidden="true">
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        </div>
        <div className={styles.body}>
          <div className={styles.filename}>{info.filename}</div>
          <div className={styles.meta}>
            {formatBytes(info.sizeBytes)}
            {info.mode !== "public" && <span className={styles.badge}>{info.mode}</span>}
            {info.expiresAt && (
              <span className={styles.expiry}>
                {t("fileAttachment.expiresPrefix")} {new Date(info.expiresAt * 1000).toLocaleString()}
              </span>
            )}
          </div>
          {error && <div className={styles.error}>{error}</div>}
        </div>
        <button
          type="button"
          className={styles.saveBtn}
          onClick={onSave}
          disabled={busy}
          title={saved ? t("fileAttachment.savedTooltip") : t("fileAttachment.downloadTooltip")}
        >
          {busy ? t("fileAttachment.saving") : saved ? t("fileAttachment.saved") : t("fileAttachment.save")}
        </button>
        {canOpenInBrowser && (
          <button
            type="button"
            className={styles.openBtn}
            onClick={handleOpenInBrowser}
            title={t("fileAttachment.openTooltip")}
          >
            {t("fileAttachment.open")}
          </button>
        )}
      </div>
      {lightboxOpen &&
        previewSrc &&
        kind === "image" &&
        createPortal(
          <MediaLightbox
            item={{ kind: "image", src: previewSrc, alt: info.filename, spoiler: false }}
            onClose={closeLightbox}
          />,
          document.body,
        )}
      {pwPromptOpen && (
        <FilePasswordDialog
          filename={info.filename}
          onConfirm={(pw) => resolvePassword(pw)}
          onCancel={() => resolvePassword(null)}
        />
      )}
    </div>
  );
}
