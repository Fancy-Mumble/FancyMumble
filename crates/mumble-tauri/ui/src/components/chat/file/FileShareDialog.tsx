import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { FileAccessMode } from "../../../types";
import styles from "./FileShareDialog.module.css";

export interface FileShareChoice {
  readonly mode: FileAccessMode;
  readonly password?: string;
  readonly message?: string;
}

interface FileShareDialogProps {
  readonly open: boolean;
  readonly filename: string;
  /** When false, the `public` and `password` modes are disabled in the
   *  UI because the server's ACL forbids the connected user from
   *  creating link-shareable uploads. */
  readonly canSharePublic?: boolean;
  readonly onSubmit: (choice: FileShareChoice) => void;
  readonly onCancel: () => void;
}


export default function FileShareDialog({
  open,
  filename,
  canSharePublic = true,
  onSubmit,
  onCancel,
}: FileShareDialogProps) {
  const { t } = useTranslation("chat");
  const { t: tc } = useTranslation("common");
  const [mode, setMode] = useState<FileAccessMode>("session");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const passwordRef = useRef<HTMLInputElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);

  // If the active mode becomes disallowed (e.g. capability flag flips
  // mid-session), fall back to the always-allowed "session" mode.
  useEffect(() => {
    if (!canSharePublic && (mode === "public" || mode === "password")) {
      setMode("session");
    }
  }, [canSharePublic, mode]);

  useEffect(() => {
    if (!open) return;
    setMode("session");
    setPassword("");
    setMessage("");
  }, [open]);

  useEffect(() => {
    if (open && mode === "password") {
      requestAnimationFrame(() => passwordRef.current?.focus());
    }
  }, [open, mode]);

  // Focus the message field on open.
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => messageRef.current?.focus());
    }
  }, [open]);

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      if (mode === "password" && password.length === 0) return;
      onSubmit({
        mode,
        password: mode === "password" ? password : undefined,
        message: message.trim() || undefined,
      });
    },
    [mode, password, message, onSubmit],
  );

  if (!open) return null;

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label={t("fileShare.title")}>
      <div className={styles.dialog}>
        <div className={styles.header}>
          <h2 className={styles.title}>{t("fileShare.title")}</h2>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onCancel}
            aria-label={tc("actions.close")}
          >
            ×
          </button>
        </div>

        <form className={styles.body} onSubmit={handleSubmit}>
          <p className={styles.message}>
            {t("fileShare.prompt", { filename })}
          </p>

          <div className={styles.modeList} role="radiogroup" aria-label="Access mode">
            {(["public", "password", "session"] as const).map((m) => {
              const restricted = !canSharePublic && (m === "public" || m === "password");
              const optionClasses = [
                styles.modeOption,
                mode === m ? styles.modeOptionActive : "",
                restricted ? styles.modeOptionDisabled : "",
              ].filter(Boolean).join(" ");
              return (
                <label key={m} className={optionClasses} title={restricted ? t("fileShare.restrictedHint") : undefined}>
                  <input
                    type="radio"
                    name="file-share-mode"
                    value={m}
                    checked={mode === m}
                    disabled={restricted}
                    onChange={() => setMode(m)}
                    className={styles.radio}
                  />
                  <div className={styles.modeText}>
                    <div className={styles.modeName}>{m}</div>
                    <div className={styles.modeDesc}>
                      {restricted ? t("fileShare.restrictedHint") : t(`fileShare.mode.${m}Desc`)}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>

          {mode === "password" && (
            <div className={styles.field}>
              <label className={styles.label} htmlFor="file-share-password">
                {t("fileShare.passwordLabel")}
              </label>
              <input
                ref={passwordRef}
                id="file-share-password"
                className={styles.input}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
          )}

          <div className={styles.field}>
            <label className={styles.label} htmlFor="file-share-message">
                {t("fileShare.messageLabel")} <span className={styles.labelOptional}>{tc("actions.optional")}</span>
            </label>
            <textarea
              ref={messageRef}
              id="file-share-message"
              className={styles.textarea}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t("fileShare.messagePlaceholder")}
              rows={2}
            />
          </div>

          <div className={styles.actions}>
            <button type="button" className={styles.cancelBtn} onClick={onCancel}>
              {tc("actions.cancel")}
            </button>
            <button
              type="submit"
              className={styles.uploadBtn}
              disabled={mode === "password" && password.length === 0}
            >
              {t("fileShare.upload")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
