import { useTranslation } from "react-i18next";
import { CloseIcon } from "../../../icons";
import styles from "./UploadProgressItem.module.css";

export interface UploadPlaceholder {
  readonly id: string;
  readonly filename: string;
  readonly state: "uploading" | "error";
  readonly errorMessage?: string;
  /** Upload progress 0-100. Present once the first progress event arrives. */
  readonly progress?: number;
}

interface UploadProgressItemProps {
  readonly placeholder: UploadPlaceholder;
  readonly onDismiss: (id: string) => void;
  readonly onCancel: (id: string) => void;
}

export default function UploadProgressItem({ placeholder, onDismiss, onCancel }: UploadProgressItemProps) {
  const { t } = useTranslation(["chat", "common"]);
  const isError = placeholder.state === "error";
  const { progress } = placeholder;
  // True once all bytes are queued for the server (stream consumed) but we
  // haven't received the response yet, so the bar pulses rather than freezing.
  const isFinalizing = progress !== undefined && progress >= 95;
  return (
    <div className={styles.wrapper}>
      <div className={`${styles.bubble} ${!isError ? styles.bubbleUploading : ""}`}>
        <div className={styles.card}>
          <div className={styles.icon} aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                 strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          </div>

          <div className={styles.body}>
            <span className={styles.filename}>{placeholder.filename}</span>
            {!isError && (
              <div
                className={styles.progressWrap}
                role="progressbar"
                aria-valuenow={progress ?? 0}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={t("upload.progressLabel")}
              >
                {progress !== undefined ? (
                  <div
                    className={`${styles.progressBarFill}${isFinalizing ? ` ${styles.progressBarFinalizing}` : ""}`}
                    style={{ width: `${progress}%` }}
                  />
                ) : (
                  <div className={styles.progressBar} />
                )}
              </div>
            )}
            {isError && (
              <span className={styles.errorText}>
                {placeholder.errorMessage ?? t("upload.failed")}
              </span>
            )}
          </div>

          {!isError && (
            <>
              <span className={styles.uploadingLabel}>
                {progress !== undefined ? `${progress}%` : t("upload.uploading")}
              </span>
              <button
                type="button"
                className={styles.dismissBtn}
                onClick={() => onCancel(placeholder.id)}
                title={t("upload.cancel")}
                aria-label={t("upload.cancel")}
              >
                <CloseIcon width={14} height={14} />
              </button>
            </>
          )}
          {isError && (
            <button
              type="button"
              className={styles.dismissBtn}
              onClick={() => onDismiss(placeholder.id)}
              title={t("common:actions.dismiss")}
              aria-label={t("upload.dismissFailed")}
            >
              <CloseIcon width={14} height={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
