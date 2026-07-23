import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDownIcon } from "../../icons";
import styles from "./SplitButton.module.css";

export interface SplitButtonOption {
  readonly label: string;
  readonly hint?: string;
  readonly onSelect: () => void;
}

interface SplitButtonProps {
  /** At least one option required.  The first option is the default
   *  (its label appears on the main button; clicking it fires
   *  `onSelect` directly without opening the menu). */
  readonly options: readonly [SplitButtonOption, ...SplitButtonOption[]];
  readonly variant?: "primary" | "danger" | "secondary";
  /** Which side the dropdown opens toward. Defaults to "up" (above the button). */
  readonly dropDirection?: "up" | "down";
}

/** GitHub-style split button: a primary action on the left and a
 *  chevron on the right that reveals a dropdown of all options. */
export function SplitButton({ options, variant = "primary", dropDirection = "up" }: SplitButtonProps) {
  const { t } = useTranslation("common");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [defaultOpt] = options;

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") setOpen(false);
  };

  return (
    <div
      className={`${styles.root} ${styles[variant]}`}
      ref={containerRef}
      onKeyDown={handleKeyDown}
    >
      <button
        type="button"
        className={`${styles.btnMain}`}
        onClick={defaultOpt.onSelect}
      >
        {defaultOpt.label}
      </button>
      <button
        type="button"
        className={`${styles.btnChevron}`}
        aria-label={t("splitButton.moreOptionsAriaLabel")}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronDownIcon width={13} height={13} />
      </button>

      {open && (
        <div className={`${styles.menu} ${dropDirection === "down" ? styles.menuDown : ""}`} role="menu">
          {options.map((opt) => (
            <button
              key={opt.label}
              type="button"
              className={styles.menuItem}
              role="menuitem"
              onClick={() => { setOpen(false); opt.onSelect(); }}
            >
              <span className={styles.menuLabel}>{opt.label}</span>
              {opt.hint !== undefined && (
                <span className={styles.menuHint}>{opt.hint}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
