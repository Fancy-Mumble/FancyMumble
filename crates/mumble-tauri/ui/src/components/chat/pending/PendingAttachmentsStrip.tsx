import { useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { convertFileSrc } from "@tauri-apps/api/core";
import { CloseIcon, FileIcon, ImageIcon, SendIcon } from "../../../icons";
import type { GalleryQuality } from "../../../utils/media";
import styles from "../ChatView.module.css";

/** A file pending review before being sent or shared. */
export interface PendingAttachment {
  /** Stable id for React keys and removal. */
  id: string;
  /** Absolute path on disk (when dropped via Tauri). */
  path: string | null;
  /** The original File blob, when available (e.g. HTML5 drag-drop). */
  file: File | null;
  /** Display name (filename portion). */
  name: string;
  /** True when the attachment is a previewable image/gif. */
  isImage: boolean;
}

interface Props {
  readonly attachments: PendingAttachment[];
  readonly onRemove: (id: string) => void;
  readonly onSend: () => void;
  /** Current gallery quality mode (only meaningful when images are staged). */
  readonly quality?: GalleryQuality;
  /** Change the gallery quality mode. */
  readonly onQualityChange?: (quality: GalleryQuality) => void;
  /** Open a full-size preview of a staged image (e.g. in the shared lightbox). */
  readonly onPreview?: (src: string) => void;
  readonly disabled?: boolean;
}

function rawPreviewSrc(att: PendingAttachment): string | null {
  if (att.file && att.isImage) return URL.createObjectURL(att.file);
  if (att.path && att.isImage) return convertFileSrc(att.path);
  return null;
}

export default function PendingAttachmentsStrip({ attachments, onRemove, onSend, quality, onQualityChange, onPreview, disabled }: Props) {
  const { t } = useTranslation("chat");
  // Build preview URLs once per attachment set and revoke object URLs on
  // change/unmount so repeated renders don't leak blobs.
  const previews = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const att of attachments) map.set(att.id, rawPreviewSrc(att));
    return map;
  }, [attachments]);
  useEffect(() => () => {
    for (const url of previews.values()) {
      if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
    }
  }, [previews]);

  if (attachments.length === 0) return null;
  const hasImage = attachments.some((a) => a.isImage);
  const showQuality = hasImage && quality != null && onQualityChange != null;

  return (
    <div className={styles.pendingAttachStrip} role="region" aria-label={t("pendingAttachments.regionAriaLabel")}>
      <div className={styles.pendingAttachItems}>
        {attachments.map((att) => {
          const src = previews.get(att.id) ?? null;
          return (
            <div key={att.id} className={styles.pendingAttachItem}>
              {src != null && onPreview ? (
                <button
                  type="button"
                  className={styles.pendingAttachThumbBtn}
                  onClick={() => onPreview(src)}
                  title={t("pendingAttachments.preview")}
                  aria-label={t("pendingAttachments.preview")}
                >
                  <img src={src} alt={att.name} className={styles.pendingAttachImg} />
                </button>
              ) : (
                <div className={styles.pendingAttachThumb}>
                  {src
                    ? <img src={src} alt={att.name} className={styles.pendingAttachImg} />
                    : <FileIcon width={28} height={28} />}
                </div>
              )}
              <div className={styles.pendingAttachMeta}>
                <span className={styles.pendingAttachName} title={att.name}>{att.name}</span>
                <span className={styles.pendingAttachKind}>
                  {att.isImage
                    ? <><ImageIcon width={12} height={12} /> {t("pendingAttachments.kindImage")}</>
                    : <><FileIcon width={12} height={12} /> {t("pendingAttachments.kindFile")}</>}
                </span>
              </div>
              <button
                type="button"
                className={styles.pendingAttachRemove}
                onClick={() => onRemove(att.id)}
                aria-label={t("pendingAttachments.remove")}
                title={t("pendingAttachments.remove")}
              >
                <CloseIcon width={14} height={14} />
              </button>
            </div>
          );
        })}
      </div>
      <div className={styles.pendingAttachActions}>
        {showQuality && (
          <div className={styles.pendingAttachQuality} role="group" aria-label={t("pendingAttachments.qualityLabel")}>
            <button
              type="button"
              className={`${styles.pendingAttachQualityBtn} ${quality === "full" ? styles.pendingAttachQualityActive : ""}`}
              onClick={() => onQualityChange?.("full")}
              aria-pressed={quality === "full"}
              title={t("pendingAttachments.qualityFullHint")}
            >
              {t("pendingAttachments.qualityFull")}
            </button>
            <button
              type="button"
              className={`${styles.pendingAttachQualityBtn} ${quality === "compressed" ? styles.pendingAttachQualityActive : ""}`}
              onClick={() => onQualityChange?.("compressed")}
              aria-pressed={quality === "compressed"}
              title={t("pendingAttachments.qualityCompressedHint")}
            >
              {t("pendingAttachments.qualityCompressed")}
            </button>
          </div>
        )}
        <button
          type="button"
          className={styles.pendingAttachSend}
          onClick={onSend}
          disabled={disabled}
          title={t("pendingAttachments.send")}
        >
          <SendIcon width={16} height={16} />
          <span>{t("pendingAttachments.send")}</span>
        </button>
      </div>
    </div>
  );
}
