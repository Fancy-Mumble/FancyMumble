/**
 * Two-factor code prompt shown when the server rejects a connect with
 * TOTPRequired / TOTPInvalid (the account has 2FA enabled). Submitting
 * re-issues the connect with the same credentials plus the entered code.
 */

import { CloseIcon } from "../../icons";
import { useState, useCallback, useRef, useEffect, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "../elements/Modal";
import { TID } from "@core/testids";
import styles from "./PasswordDialog.module.css";

interface TotpDialogProps {
  readonly open: boolean;
  readonly onSubmit: (code: string) => void;
  readonly onCancel: () => void;
  readonly serverHost?: string;
  readonly username?: string;
  readonly error?: string | null;
}

export default function TotpDialog({
  open,
  onSubmit,
  onCancel,
  serverHost,
  username,
  error,
}: TotpDialogProps) {
  const { t } = useTranslation(["server", "common"]);
  const [code, setCode] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setCode("");
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      if (code.length === 6) onSubmit(code);
    },
    [code, onSubmit],
  );

  if (!open) return null;

  const target = username && serverHost ? `${username} on ${serverHost}` : (serverHost ?? "this server");

  return (
    <Modal
      onClose={onCancel}
      closeOnEsc={false}
      closeOnOverlayClick={false}
      zIndex={200}
      overlayClassName={styles.overlayBlur}
    >
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label={t("totp.title")}>
        <div className={styles.header}>
          <h2 className={styles.title}>{t("totp.title")}</h2>
          <button
            className={styles.closeBtn}
            onClick={onCancel}
            aria-label={t("common:actions.close")}
            type="button"
          >
            <CloseIcon width={16} height={16} />
          </button>
        </div>

        <form className={styles.body} onSubmit={handleSubmit}>
          {error && <p className={styles.error}>{error}</p>}
          <p className={styles.message}>
            <span dangerouslySetInnerHTML={{ __html: t("totp.enterMessage", { target }) }} />
          </p>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="totp-dialog-input">
              {t("totp.codeLabel")}
            </label>
            <input
              ref={inputRef}
              id="totp-dialog-input"
              data-testid={TID.connectTotpInput}
              className={styles.input}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="123456"
            />
          </div>

          <div className={styles.actions}>
            <button className={styles.cancelBtn} type="button" onClick={onCancel}>
              {t("common:actions.cancel")}
            </button>
            <button
              className={styles.connectBtn}
              data-testid={TID.connectTotpSubmit}
              type="submit"
              disabled={code.length !== 6}
            >
              {t("totp.connect")}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
