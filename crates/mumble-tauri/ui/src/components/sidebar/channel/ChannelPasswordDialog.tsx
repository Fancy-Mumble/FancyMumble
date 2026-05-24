import { useState, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { ChannelEntry } from "../../../types";
import styles from "./ChannelPasswordDialog.module.css";

interface ChannelPasswordDialogProps {
  channel: ChannelEntry;
  onConfirm: (password: string) => void;
  onCancel: () => void;
}

export function ChannelPasswordDialog({ channel, onConfirm, onCancel }: Readonly<ChannelPasswordDialogProps>) {
  const { t } = useTranslation("sidebar");
  const [password, setPassword] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    },
    [onCancel],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onCancel();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password.trim()) onConfirm(password.trim());
  };

  return createPortal(
    <div className={styles.overlay} onMouseDown={handleOverlayClick}>
      <form className={styles.dialog} role="dialog" aria-modal="true" onSubmit={handleSubmit}>
        <h3 className={styles.title}>{t("channelPassword.title")}</h3>
        <p className={styles.body}>
          <strong>{channel.name}</strong>{t("channelPassword.body")}
        </p>
        <input
          ref={inputRef}
          type="password"
          className={styles.input}
          placeholder={t("channelPassword.placeholder")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="off"
        />
        <div className={styles.actions}>
          <button type="button" className={styles.cancelBtn} onClick={onCancel}>{t("channelPassword.cancelBtn")}</button>
          <button type="submit" className={styles.confirmBtn} disabled={!password.trim()}>
            {t("channelPassword.joinBtn")}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
