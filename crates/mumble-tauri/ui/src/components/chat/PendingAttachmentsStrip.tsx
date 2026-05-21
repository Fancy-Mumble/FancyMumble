import { useTranslation } from "react-i18next";
import { convertFileSrc } from "@tauri-apps/api/core";
import { CloseIcon, FileIcon, ImageIcon, SendIcon } from "../../icons";
import styles from "./ChatView.module.css";

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
  readonly disabled?: boolean;
}

function previewSrc(att: PendingAttachment): string | null {
  if (att.file && att.isImage) return URL.createObjectURL(att.file);
  if (att.path && att.isImage) return convertFileSrc(att.path);
  return null;
}

export default function PendingAttachmentsStrip({ attachments, onRemove, onSend, disabled }: Props) {
  const { t } = useTranslation("chat");
  if (attachments.length === 0) return null;

  return (
    <div className={styles.pendingAttachStrip} role="region" aria-label={t("pendingAttachments.regionAriaLabel")}>
      <div className={styles.pendingAttachItems}>
        {attachments.map((att) => {
          const src = previewSrc(att);
          return (
            <div key={att.id} className={styles.pendingAttachItem}>
              <div className={styles.pendingAttachThumb}>
                {src
                  ? <img src={src} alt={att.name} className={styles.pendingAttachImg} />
                  : <FileIcon width={28} height={28} />}
              </div>
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
  );
}
