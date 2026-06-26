import { useState, useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "./Modal";
import { TID } from "../../testids";
import styles from "./PasswordPromptDialog.module.css";

interface PasswordPromptDialogProps {
  /** Heading shown at the top of the dialog. */
  readonly title: string;
  /** Optional descriptive line under the title (may include markup). */
  readonly body?: ReactNode;
  /** Placeholder for the password input. */
  readonly placeholder?: string;
  /** Label for the confirm button (e.g. "Join", "Unlock"). */
  readonly confirmLabel: string;
  /** Label for the cancel button (defaults to the shared "Cancel"). */
  readonly cancelLabel?: string;
  /** When true, the entered password is passed through verbatim (no trim).
   *  Use for values that must match exactly, e.g. file-encryption passwords. */
  readonly preserveWhitespace?: boolean;
  readonly onConfirm: (password: string) => void;
  readonly onCancel: () => void;
}

/**
 * Shared single-field password-entry dialog: autofocus, Enter to submit, and
 * (via {@link Modal}) Esc / backdrop click to cancel.  Backs the channel-join
 * and file-download password prompts so the scaffolding lives in one place.
 */
export function PasswordPromptDialog({
  title,
  body,
  placeholder,
  confirmLabel,
  cancelLabel,
  preserveWhitespace = false,
  onConfirm,
  onCancel,
}: PasswordPromptDialogProps) {
  const { t } = useTranslation("common");
  const [password, setPassword] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const value = preserveWhitespace ? password : password.trim();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value) onConfirm(value);
  };

  return (
    <Modal onClose={onCancel}>
      <form
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        data-testid={TID.passwordPromptDialog}
        onSubmit={handleSubmit}
      >
        <h3 className={styles.title}>{title}</h3>
        {body != null && <p className={styles.body}>{body}</p>}
        <input
          ref={inputRef}
          type="password"
          className={styles.input}
          placeholder={placeholder}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="off"
        />
        <div className={styles.actions}>
          <button type="button" className={styles.cancelBtn} onClick={onCancel}>
            {cancelLabel ?? t("actions.cancel")}
          </button>
          <button type="submit" className={styles.confirmBtn} disabled={!value}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
