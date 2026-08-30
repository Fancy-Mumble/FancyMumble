import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { convertFileSrc } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useAppStore } from "@core/store";
import { previewKindForFilename, type FileAttachmentInfo } from "@core/features/chat/fileAttachments";
import {
  isCanonAttachment,
  saveCanonAttachment,
  useCanonPreviewSrc,
} from "@core/features/chat/starlingFiles";
import { formatBytes } from "@core/utils/format";
import { MediaLightbox } from "../media/MediaPreview";
import MediaPlayer from "@shared/mediaplayer/MediaPlayer";
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
  /**
   * The reach-of-this-file flag, drawn by the caller. A picture is the whole
   * card when there is one, so the flag rides in its bottom-left corner
   * rather than pushing the image down a line; anything else has no image to
   * ride on and gets it above the row instead. The flag is told which of the
   * two it got: a scrim it needs over a photograph would only look like dirt
   * on the card.
   */
  readonly visibilityBadge?: (overlaid: boolean) => ReactNode;
}

/** HTML-comment marker used to embed a file attachment in a chat message
 *  body. Renderers detect the marker and render a {@link FileAttachmentCard}
 *  in place of the raw markdown link. Legacy clients see the inert comment. */
export default function FileAttachmentCard({ info, visibilityBadge }: FileAttachmentCardProps) {
  const { t } = useTranslation("chat");
  const downloadFile = useAppStore((s) => s.downloadFile);
  const addDownload = useAppStore((s) => s.addDownload);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  /** Bumped by Retry, to mount a player that has not already failed. */
  const [attempt, setAttempt] = useState(0);
  // Native password prompt (replaces window.prompt): the open flag drives the
  // dialog and a stored resolver hands the entered value back to `onSave`.
  const [pwPromptOpen, setPwPromptOpen] = useState(false);
  const pwResolverRef = useRef<((value: string | null) => void) | null>(null);
  const initiallyExpired = info.expiresAt != null && info.expiresAt > 0 && info.expiresAt * 1000 < Date.now();
  const [expired, setExpired] = useState<boolean>(initiallyExpired);

  const kind = previewKindForFilename(info.filename);
  const previewable = kind === "image" || kind === "audio" || kind === "video";
  // A file whose URL only the server can mint, one look at a time.
  const canon = isCanonAttachment(info);
  const canonSrc = useCanonPreviewSrc(info);

  // Post-download: local asset URL (works for any access mode).
  // Pre-download: public files only - URL is a signed but open link. A canon
  // attachment has no open link at all: a picture is bytes this client
  // fetched, and sound or video is an address on the loopback origin that the
  // player pulls a range at a time.
  //
  // Saving does not move a canon player onto the saved copy: a webview's media
  // stack cannot load `asset:` at all (see `state/media_server.rs`), so the
  // local URL that works for a picture would silently break a video.
  const streams = canon && (kind === "audio" || kind === "video");
  const previewSrc = streams
    ? canonSrc
    : savedPath
      ? convertFileSrc(savedPath)
      : canon
        ? canonSrc
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
    // Nothing to probe for a canon attachment: it has no URL to ask about,
    // and it never expires on its own - the server keeps it or collects it.
    if (canon) return;
    void probeForExpiry();
  }, [expired, probeForExpiry, canon]);

  // Never for a canon attachment: there is no address to open. The URL that
  // reaches this client is good for one request and about a minute.
  const canOpenInBrowser = !canon && (info.mode === "public" || info.mode === "password") && !expired;

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
      const written = canon
        ? await saveCanonAttachment(
            info.key ?? "",
            dest,
            // A canon password share is sealed, so saving it takes the same
            // two steps a browser does: the password buys a ticket, and the
            // ticket buys the bytes. The other two modes need none of it.
            info.mode === "password" && password !== undefined
              ? { url: info.url, password }
              : undefined,
          )
        : await downloadFile({ url: info.url, destPath: dest, password });
      addDownload({
        filename: info.filename,
        destPath: dest,
        sizeBytes: written,
        // The key stands in for the URL in the downloads list, because it is
        // the only lasting name this file has.
        sourceUrl: canon ? (info.key ?? "") : info.url,
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
  }, [downloadFile, addDownload, info, askPassword, canon]);

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
    if (kind === "audio" || kind === "video") {
      // Our own controls rather than the platform's: see `MediaPlayer`. Retry
      // remounts the player on a fresh source, which for a canon attachment
      // means a freshly signed URL rather than the one that stopped working.
      return (
        <div className={kind === "audio" ? styles.previewAudioWrap : undefined}>
          <MediaPlayer
            key={`${previewSrc}#${attempt}`}
            src={previewSrc}
            kind={kind}
            label={info.filename}
            onRetry={() => {
              handlePreviewError();
              setAttempt((count) => count + 1);
            }}
          />
        </div>
      );
    }
    return null;
  })();

  // Only a still picture can carry the flag: a player already owns its own
  // bottom-left corner, and a card with no preview has no corner at all.
  const overlaysPreview = !!visibilityBadge && !!preview && kind === "image";

  if (expired) {
    return (
      <div className={`${styles.card} ${styles.expiredCard}`}>
        {visibilityBadge && <div className={styles.badgeRow}>{visibilityBadge(false)}</div>}
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
      {overlaysPreview ? (
        <div className={styles.previewWrap}>
          {preview}
          <div className={styles.previewOverlay}>{visibilityBadge?.(true)}</div>
        </div>
      ) : (
        <>
          {visibilityBadge && <div className={styles.badgeRow}>{visibilityBadge(false)}</div>}
          {preview}
        </>
      )}
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
