import type { ReactNode, SelectHTMLAttributes } from "react";
import styles from "./SettingsLayout.module.css";

export interface SettingsSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** Accessible name; the visible label lives on the enclosing row. */
  label: string;
  children: ReactNode;
}

/**
 * The select used inside a {@link SettingsRow}.
 *
 * Distinct from the `SelectField` primitive, which draws its own label - here
 * the row already supplies the label and hint, so a second one would duplicate.
 */
export default function SettingsSelect({ label, children, className, ...props }: SettingsSelectProps) {
  return (
    <select className={`${styles.select} ${className ?? ""}`} aria-label={label} {...props}>
      {children}
    </select>
  );
}
