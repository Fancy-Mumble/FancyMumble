import { WarningIcon } from "../../icons";
import { useTranslation } from "react-i18next";
import type { PersistenceMode } from "../../types";
import styles from "./KeyShareWarningDialog.module.css";

interface KeyShareWarningDialogProps {
  readonly open: boolean;
  readonly peerName: string;
  readonly persistenceMode: PersistenceMode;
  readonly totalStored: number;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

function describeAccess(mode: PersistenceMode, totalStored: number, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (mode === "FANCY_V1_FULL_ARCHIVE") {
    const count = totalStored > 0 ? t("keyShare.archiveCount", { count: totalStored }) : "";
    return t("keyShare.archiveAccess", { count });
  }
  return t("keyShare.genericAccess");
}

export default function KeyShareWarningDialog({
  open,
  peerName,
  persistenceMode,
  totalStored,
  onConfirm,
  onCancel,
}: KeyShareWarningDialogProps) {
  const { t } = useTranslation("sidebar");
  const tStr = t as (key: string, opts?: Record<string, unknown>) => string;
  if (!open) return null;

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label={t("keyShare.ariaLabel")}>
      <div className={styles.dialog}>
        <div className={styles.header}>
          <h2 className={styles.title}>{t("keyShare.title")}</h2>
          <button
            className={styles.closeBtn}
            onClick={onCancel}
            aria-label={t("keyShare.closeAriaLabel")}
            type="button"
          >
            &times;
          </button>
        </div>

        <div className={styles.body}>
          <div className={styles.warningBanner}>
            <WarningIcon className={styles.warningIcon} width={20} height={20} />
            <span>{describeAccess(persistenceMode, totalStored, tStr)}</span>
          </div>

          <p className={styles.message}>
            <span dangerouslySetInnerHTML={{ __html: t("keyShare.confirmMessage", { name: peerName }) }} />
          </p>

          <div className={styles.actions}>
            <button
              className={styles.cancelBtn}
              type="button"
              onClick={onCancel}
            >
              {t("keyShare.cancel")}
            </button>
            <button
              className={styles.confirmBtn}
              type="button"
              onClick={onConfirm}
            >
              {t("keyShare.share")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
