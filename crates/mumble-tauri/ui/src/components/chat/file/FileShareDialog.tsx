import { CloseIcon } from "../../../icons";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { FileAccessMode } from "../../../types";
import { useAppStore } from "../../../store";
import { Modal } from "../../elements/Modal";
import styles from "./FileShareDialog.module.css";

export interface FileShareChoice {
  readonly mode: FileAccessMode;
  readonly password?: string;
  readonly message?: string;
  /** Requested lifetime in seconds: `undefined` = server default, `0` = never
   *  expire, otherwise the exact duration (clamped server-side to the max). */
  readonly ttlSeconds?: number;
}

/** Selectable lifetime presets (seconds). Filtered against the server's
 *  configured maximum before display. `key` indexes the i18n label;
 *  `label` is the English fallback. */
const TTL_PRESETS: ReadonlyArray<{ readonly secs: number; readonly key: string; readonly label: string }> = [
  { secs: 3600, key: "h1", label: "1 hour" },
  { secs: 86_400, key: "d1", label: "1 day" },
  { secs: 604_800, key: "w1", label: "1 week" },
  { secs: 2_592_000, key: "mo1", label: "1 month" },
  { secs: 31_536_000, key: "y1", label: "1 year" },
];

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
  // Lifetime choice: "default" | "never" | "max" | a seconds string.
  const [ttlChoice, setTtlChoice] = useState<string>("default");
  const passwordRef = useRef<HTMLInputElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);

  const maxTtl = useAppStore((s) => s.fileServerConfig?.maxTtlSeconds ?? 0);
  const availablePresets = useMemo(
    () => TTL_PRESETS.filter((p) => maxTtl === 0 || p.secs <= maxTtl),
    [maxTtl],
  );
  // Offer "Maximum allowed" only when the cap isn't already one of the presets.
  const showMax = maxTtl > 0 && !TTL_PRESETS.some((p) => p.secs === maxTtl);
  // "Never" is only honoured when there is no cap.
  const showNever = maxTtl === 0;

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
    setTtlChoice("default");
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
      let ttlSeconds: number | undefined;
      if (ttlChoice === "default") ttlSeconds = undefined;
      else if (ttlChoice === "never") ttlSeconds = 0;
      else if (ttlChoice === "max") ttlSeconds = maxTtl;
      else ttlSeconds = Number(ttlChoice);
      onSubmit({
        mode,
        password: mode === "password" ? password : undefined,
        message: message.trim() || undefined,
        ttlSeconds,
      });
    },
    [mode, password, message, ttlChoice, maxTtl, onSubmit],
  );

  if (!open) return null;

  return (
    <Modal
      onClose={onCancel}
      closeOnEsc={false}
      closeOnOverlayClick={false}
      zIndex={200}
      overlayClassName={styles.overlayBlur}
    >
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label={t("fileShare.title")}>
        <div className={styles.header}>
          <h2 className={styles.title}>{t("fileShare.title")}</h2>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onCancel}
            aria-label={tc("actions.close")}
          >
            <CloseIcon width={16} height={16} />
          </button>
        </div>

        <form className={styles.body} onSubmit={handleSubmit}>
          <p className={styles.message}>
            {t("fileShare.prompt", { filename })}
          </p>

          <div className={styles.modeList} role="radiogroup" aria-label={t("fileShare.accessMode")}>
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
                    <div className={styles.modeName}>{t(`fileShareMode.${m}`)}</div>
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

          <div className={styles.field}>
            <label className={styles.label} htmlFor="file-share-ttl">
              {t("fileShare.duration.label")}
            </label>
            <select
              id="file-share-ttl"
              className={styles.input}
              value={ttlChoice}
              onChange={(e) => setTtlChoice(e.target.value)}
            >
              <option value="default">{t("fileShare.duration.default")}</option>
              {availablePresets.map((p) => (
                <option key={p.key} value={String(p.secs)}>
                  {t(`fileShare.duration.${p.key}`, { defaultValue: p.label })}
                </option>
              ))}
              {showMax && <option value="max">{t("fileShare.duration.max")}</option>}
              {showNever && <option value="never">{t("fileShare.duration.never")}</option>}
            </select>
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
    </Modal>
  );
}
