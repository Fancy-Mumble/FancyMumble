import { useTranslation } from "react-i18next";
import { Modal } from "./Modal";
import styles from "./ConfirmDialog.module.css";

interface ConfirmDialogProps {
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  isConfirming?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** When provided, an opt-out checkbox is shown above the actions (e.g.
   *  "Don't show this again").  Controlled via {@link checkboxChecked} /
   *  {@link onCheckboxChange}. */
  checkboxLabel?: string;
  checkboxChecked?: boolean;
  onCheckboxChange?: (checked: boolean) => void;
}

export default function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel,
  danger = false,
  isConfirming = false,
  onConfirm,
  onCancel,
  checkboxLabel,
  checkboxChecked = false,
  onCheckboxChange,
}: ConfirmDialogProps) {
  const { t } = useTranslation("common");
  const resolvedConfirm = confirmLabel ?? t("confirmDialog.confirmLabel");
  const resolvedCancel = cancelLabel ?? t("confirmDialog.cancelLabel");
  return (
    <Modal onClose={onCancel} zIndex={9999}>
      <div className={styles.dialog} role="alertdialog" aria-labelledby="confirm-title" aria-describedby="confirm-body">
        <h3 id="confirm-title" className={`${styles.title} ${danger ? styles.titleDanger : ""}`}>
          {title}
        </h3>
        <p id="confirm-body" className={styles.body}>
          {body}
        </p>
        {checkboxLabel && (
          <label className={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={checkboxChecked}
              onChange={(e) => onCheckboxChange?.(e.target.checked)}
            />
            <span>{checkboxLabel}</span>
          </label>
        )}
        <div className={styles.actions}>
          <button className={styles.cancelBtn} onClick={onCancel}>
            {resolvedCancel}
          </button>
          <button
            className={`${styles.confirmBtn} ${danger ? styles.confirmBtnDanger : ""}`}
            onClick={onConfirm}
            disabled={isConfirming}
          >
            {resolvedConfirm}
          </button>
        </div>
      </div>
    </Modal>
  );
}
