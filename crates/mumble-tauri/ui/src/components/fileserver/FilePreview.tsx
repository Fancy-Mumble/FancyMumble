/**
 * Shared file-server file presentation: a lazy thumbnail, a full-size preview
 * modal, a category icon, and a TTL badge.  Extracted from the admin
 * FileServerTab so the per-user "my shared files" bar renders files identically.
 *
 * Where the file bytes come from is abstracted behind [`FilePreviewSource`],
 * so the admin dashboard (`/admin/files`) and a user's own files (`/me/files`)
 * can share the exact same UI while hitting different, separately-authorised
 * endpoints.
 */

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatBytes } from "../../utils/format";
import { expiryInfo } from "../../utils/expiry";
import type { AdminFileEntry } from "../../types";
import {
  ImageIcon, PlayIcon, VolumeIcon, FileTextIcon, FolderIcon, FileIcon, CloseIcon,
} from "../../icons";
import { categorize, isPreviewable, type FileCategory } from "./fileTypes";
import styles from "./FilePreview.module.css";

/** Cap thumbnails so a huge image isn't pulled inline behind a tiny cell. */
const THUMB_MAX_BYTES = 8 * 1024 * 1024;
/** Cap modal previews at the server's preview ceiling. */
const PREVIEW_MAX_BYTES = 32 * 1024 * 1024;

/** Abstracts how a file's bytes are fetched, so the same preview UI serves the
 *  admin dashboard and a user's own files via different (separately authorised)
 *  endpoints. */
export interface FilePreviewSource {
  loadPreviewUrl(fileId: string, mime: string, maxBytes: number): Promise<string>;
  loadPreviewText(fileId: string, maxBytes: number): Promise<string>;
}

/** Icon for a broad MIME category. */
export function CategoryIcon({ cat, size = 18 }: { cat: FileCategory; size?: number }) {
  switch (cat) {
    case "image": return <ImageIcon width={size} height={size} />;
    case "video": return <PlayIcon width={size} height={size} />;
    case "audio": return <VolumeIcon width={size} height={size} />;
    case "document": return <FileTextIcon width={size} height={size} />;
    case "archive": return <FolderIcon width={size} height={size} />;
    default: return <FileIcon width={size} height={size} />;
  }
}

/** Lazy image thumbnail (loads when scrolled into view); icon otherwise. */
export function FileThumb({
  file, source, onOpen,
}: { file: AdminFileEntry; source: FilePreviewSource; onOpen: (f: AdminFileEntry) => void }) {
  const cat = categorize(file.mime_type);
  // Password-protected files are encrypted at rest: the server cannot decrypt
  // them without the password, so previews/thumbnails are unavailable (403).
  // Skip the fetch entirely and show the category icon instead.
  const encrypted = file.access_mode === "password";
  const isImage = cat === "image" && file.mime_type.toLowerCase() !== "image/svg+xml" && !encrypted;
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isImage || !ref.current) return;
    const el = ref.current;
    let cancelled = false;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      source.loadPreviewUrl(file.id, file.mime_type, THUMB_MAX_BYTES)
        .then((u) => { if (!cancelled) setUrl(u); })
        .catch(() => { if (!cancelled) setFailed(true); });
    });
    io.observe(el);
    return () => { cancelled = true; io.disconnect(); };
  }, [file.id, file.mime_type, isImage, source]);

  const previewable = isPreviewable(file.mime_type) && !encrypted;
  return (
    <button
      ref={ref}
      type="button"
      className={styles.thumb}
      onClick={() => previewable && onOpen(file)}
      disabled={!previewable}
      title={previewable ? file.filename : undefined}
    >
      {isImage && url && !failed
        ? <img src={url} alt="" loading="lazy" />
        : <CategoryIcon cat={cat} />}
    </button>
  );
}

/** Full-size preview overlay for a single file. */
export function PreviewModal({
  file, source, onClose,
}: { file: AdminFileEntry; source: FilePreviewSource; onClose: () => void }) {
  const { t } = useTranslation("settings");
  const mime = file.mime_type.toLowerCase();
  const cat = categorize(file.mime_type);
  const isText = mime.startsWith("text/") || mime === "application/json" || mime === "application/xml";
  type State =
    | { kind: "loading" }
    | { kind: "url"; url: string }
    | { kind: "text"; text: string }
    | { kind: "error"; msg: string };
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (isText) {
          const text = await source.loadPreviewText(file.id, PREVIEW_MAX_BYTES);
          if (!cancelled) setState({ kind: "text", text });
        } else {
          const url = await source.loadPreviewUrl(file.id, file.mime_type, PREVIEW_MAX_BYTES);
          if (!cancelled) setState({ kind: "url", url });
        }
      } catch (e) {
        if (!cancelled) setState({ kind: "error", msg: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => { cancelled = true; };
  }, [file.id, file.mime_type, isText, source]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  let body: React.ReactNode;
  if (state.kind === "loading") body = <div className={styles.previewMsg}>{t("fileServer.previewLoading", { defaultValue: "Loading preview…" })}</div>;
  else if (state.kind === "error") body = <div className={styles.previewMsg}>{t("fileServer.previewError", { defaultValue: "Preview failed" })}: {state.msg}</div>;
  else if (state.kind === "text") body = <pre className={styles.previewText}>{state.text}</pre>;
  else if (cat === "image") body = <img className={styles.previewMedia} src={state.url} alt={file.filename} />;
  else if (cat === "video") body = <video className={styles.previewMedia} src={state.url} controls autoPlay />;
  else if (cat === "audio") body = <audio src={state.url} controls autoPlay />;
  else if (mime === "application/pdf") body = <iframe className={styles.previewFrame} src={state.url} title={file.filename} />;
  else body = <div className={styles.previewMsg}>{t("fileServer.previewUnavailable", { defaultValue: "No inline preview for this type." })}</div>;

  return (
    <div className={styles.previewBackdrop} onClick={onClose} role="presentation">
      <div className={styles.previewBox} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={file.filename}>
        <div className={styles.previewHead}>
          <span className={styles.previewName} title={file.filename}>{file.filename}</span>
          <span className={styles.previewSize}>{formatBytes(file.size_bytes)}</span>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label={t("fileServer.previewClose", { defaultValue: "Close" })}>
            <CloseIcon width={16} height={16} />
          </button>
        </div>
        <div className={styles.previewBody}>{body}</div>
      </div>
    </div>
  );
}

/** Badge showing how long until a file's TTL removes it (e.g. "in 3 days"),
 *  coloured by urgency, with the absolute expiry time in the tooltip. */
export function ExpiryBadge({ expiresAt }: { expiresAt: number }) {
  const { t } = useTranslation("settings");
  const info = expiryInfo(expiresAt);
  if (!info.hasExpiry || info.relative == null) return null;
  const cls = info.expired
    ? styles.ttlExpired
    : info.soon
      ? styles.ttlSoon
      : info.far
        ? styles.ttlFar
        : styles.ttlTag;
  const title = info.expired
    ? t("fileServer.expiredAt", { defaultValue: "Expired {{when}}", when: info.absolute ?? "" })
    : t("fileServer.expiresAt", { defaultValue: "Expires {{when}}", when: info.absolute ?? "" });
  return <span className={cls} title={title}>{info.relative}</span>;
}
