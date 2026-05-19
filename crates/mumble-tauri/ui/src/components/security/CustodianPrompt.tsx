import { CloseIcon, ShieldIcon, WarningIcon } from "../../icons";
import { useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import styles from "./CustodianPrompt.module.css";

interface Custodian {
  readonly hash: string;
  readonly name?: string;
}

interface CustodianPromptProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
  readonly custodians: Custodian[];
  readonly isFirstJoin: boolean;
  readonly removedCustodians?: Custodian[];
  readonly addedCustodians?: Custodian[];
}

export default function CustodianPrompt({
  open,
  onClose,
  onConfirm,
  custodians,
  isFirstJoin,
  removedCustodians,
  addedCustodians,
}: CustodianPromptProps) {
  const { t } = useTranslation("sidebar");

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const handleConfirm = useCallback(() => {
    onConfirm();
    onClose();
  }, [onConfirm, onClose]);

  if (!open) return null;

  const isChange = !isFirstJoin;
  const title = isChange ? t("custodian.titleChange") : t("custodian.titleFirstJoin");
  const description = isChange
    ? t("custodian.descriptionChange")
    : t("custodian.descriptionFirstJoin", { count: custodians.length });

  return (
    <dialog className={styles.overlay} open aria-label={title}>
      <div className={styles.dialog}>
        <div className={styles.header}>
          <h3 className={styles.title}>{title}</h3>
          <button className={styles.closeBtn} onClick={onClose} aria-label={t("custodian.closeAriaLabel")}>
            <CloseIcon width={16} height={16} />
          </button>
        </div>

        <div className={styles.body}>
          <p className={styles.description}>{description}</p>

          {isChange && (
            <div className={styles.warning}>
              <WarningIcon className={styles.warningIcon} aria-hidden="true" />
              <span>
                {t("custodian.warningChange")}
              </span>
            </div>
          )}

          {/* Show changes for custodian-change scenario */}
          {isChange && addedCustodians && addedCustodians.length > 0 && (
            <ul className={styles.custodianList}>
              {addedCustodians.map((c) => (
                <li key={c.hash} className={`${styles.custodianItem} ${styles.changeAdded}`}>
                  <ShieldIcon className={styles.custodianIcon} aria-hidden="true" />
                  <span className={styles.custodianName}>{c.name ?? t("custodian.unknownCustodian")}</span>
                  <span className={styles.custodianHash}>{c.hash.slice(0, 12)}...</span>
                  <span className={`${styles.changeBadge} ${styles.badgeAdded}`}>{t("custodian.badgeAdded")}</span>
                </li>
              ))}
            </ul>
          )}

          {isChange && removedCustodians && removedCustodians.length > 0 && (
            <ul className={styles.custodianList}>
              {removedCustodians.map((c) => (
                <li key={c.hash} className={`${styles.custodianItem} ${styles.changeRemoved}`}>
                  <ShieldIcon className={styles.custodianIcon} aria-hidden="true" />
                  <span className={styles.custodianName}>{c.name ?? t("custodian.unknownCustodian")}</span>
                  <span className={styles.custodianHash}>{c.hash.slice(0, 12)}...</span>
                  <span className={`${styles.changeBadge} ${styles.badgeRemoved}`}>{t("custodian.badgeRemoved")}</span>
                </li>
              ))}
            </ul>
          )}

          {/* Current custodian list for first-join scenario */}
          {isFirstJoin && (
            <ul className={styles.custodianList}>
              {custodians.map((c) => (
                <li key={c.hash} className={styles.custodianItem}>
                  <ShieldIcon className={styles.custodianIcon} aria-hidden="true" />
                  <span className={styles.custodianName}>{c.name ?? t("custodian.unknownCustodian")}</span>
                  <span className={styles.custodianHash}>{c.hash.slice(0, 12)}...</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className={styles.footer}>
          <button className={styles.btnSecondary} onClick={onClose}>
            {isChange ? t("custodian.dismiss") : t("custodian.later")}
          </button>
          <button className={styles.btnPrimary} onClick={handleConfirm}>
            {isChange ? t("custodian.accept") : t("custodian.confirm")}
          </button>
        </div>
      </div>
    </dialog>
  );
}
