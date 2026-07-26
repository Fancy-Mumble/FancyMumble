import type { ReactNode } from "react";
import styles from "./SettingsLayout.module.css";

export interface SettingsFieldProps {
  label: string;
  /** Live readout shown beside the label, e.g. "35%" or "72 kb/s". */
  value?: ReactNode;
  hint?: string;
  children: ReactNode;
}

/**
 * A setting whose control takes the full width, with the control under the
 * label rather than beside it.
 *
 * Use this for anything the eye has to travel along - sliders, card pickers,
 * radio groups. {@link SettingsRow} is for controls small enough to sit at the
 * end of the line, like a toggle or a button.
 */
export default function SettingsField({ label, value, hint, children }: SettingsFieldProps) {
  return (
    <div className={styles.field}>
      <div className={styles.fieldHead}>
        <strong className={styles.fieldLabel}>{label}</strong>
        {value !== undefined && <span className={styles.fieldValue}>{value}</span>}
      </div>
      {hint && <small className={styles.fieldHint}>{hint}</small>}
      <div className={styles.fieldControl}>{children}</div>
    </div>
  );
}
