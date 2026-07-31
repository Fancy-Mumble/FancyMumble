import type { InputHTMLAttributes, ReactNode } from "react";
import { CheckIcon } from "@ui/icons";
import styles from "./Checkbox.module.css";

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  /** Text beside the box. Omit for a bare checkbox, e.g. a table's select column. */
  label?: ReactNode;
}

/**
 * A checkbox that obeys the design.
 *
 * The native control renders at the platform's own size and ignores font-size,
 * which is why an unstyled `<input type="checkbox">` towers over the 12px text
 * next to it. This keeps the real input for behaviour and accessibility and
 * draws the box itself.
 */
export default function Checkbox({ label, className, disabled, ...props }: CheckboxProps) {
  return (
    <label className={`${styles.checkbox} ${disabled ? styles.disabled : ""} ${className ?? ""}`}>
      <input type="checkbox" disabled={disabled} {...props} />
      <span className={styles.box}>
        <CheckIcon size={12} className={styles.tick} />
      </span>
      {label}
    </label>
  );
}
