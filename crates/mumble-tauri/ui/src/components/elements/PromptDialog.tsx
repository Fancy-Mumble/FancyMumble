import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "./Modal";
import { usePromptDialogStore } from "./promptDialogStore";
import styles from "./PromptDialog.module.css";

/**
 * Singleton host for the imperative {@link openPrompt} API.  Mount once near
 * the app root.  Renders a native modal with a single text input as a
 * replacement for `window.prompt`.
 */
export default function PromptDialog() {
  const { t } = useTranslation("common");
  const open = usePromptDialogStore((s) => s.open);
  const options = usePromptDialogStore((s) => s.options);
  const confirm = usePromptDialogStore((s) => s.confirm);
  const cancel = usePromptDialogStore((s) => s.cancel);

  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue(options?.defaultValue ?? "");
    }
  }, [open, options?.defaultValue]);

  useEffect(() => {
    if (open) {
      const id = requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
      return () => cancelAnimationFrame(id);
    }
  }, [open]);

  if (!open || !options) return null;

  const submit = () => confirm(value);
  const canSubmit = value.trim().length > 0;

  // Esc + backdrop dismissal are handled by Modal; only Enter-to-submit lives
  // on the input.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && canSubmit) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <Modal onClose={cancel} zIndex={9999}>
      <div className={styles.dialog} role="dialog" aria-labelledby="prompt-title" aria-modal="true">
        <h3 id="prompt-title" className={styles.title}>
          {options.title}
        </h3>
        {options.label && <label htmlFor="prompt-input" className={styles.label}>{options.label}</label>}
        <input
          id="prompt-input"
          ref={inputRef}
          className={styles.input}
          type="text"
          value={value}
          placeholder={options.placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className={styles.actions}>
          <button className={styles.cancelBtn} onClick={cancel}>
            {options.cancelLabel ?? t("actions.cancel")}
          </button>
          <button className={styles.confirmBtn} onClick={submit} disabled={!canSubmit}>
            {options.confirmLabel ?? t("confirmDialog.confirmLabel")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
