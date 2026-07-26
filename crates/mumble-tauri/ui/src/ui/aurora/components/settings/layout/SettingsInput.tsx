import type { InputHTMLAttributes } from "react";
import styles from "./SettingsLayout.module.css";

export interface SettingsInputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Accessible name; the visible label lives on the enclosing row. */
  label: string;
}

/**
 * The text input used inside a {@link SettingsRow}.
 *
 * Sibling to `SettingsSelect`, and distinct from the `TextField` primitive for
 * the same reason: the row already carries the label.
 */
export default function SettingsInput({ label, className, ...props }: SettingsInputProps) {
  return <input className={`${styles.select} ${className ?? ""}`} aria-label={label} {...props} />;
}
