import type { ReactNode } from "react";
import styles from "./SettingsLayout.module.css";

export interface SettingsRowProps {
  title: string;
  detail?: string;
  /**
   * Reserves a fixed column for the control. Use for selects and sliders so a
   * stack of them shares one right edge; leave off for toggles and buttons,
   * which look wrong stretched.
   */
  wide?: boolean;
  /** Full-width element rendered under the label, e.g. a level meter. */
  meter?: ReactNode;
  children: ReactNode;
}

/** One setting: what it is, what it does, and the control that changes it. */
export default function SettingsRow({ title, detail, wide, meter, children }: SettingsRowProps) {
  return (
    <div className={styles.row}>
      <span className={styles.info}>
        <strong className={styles.rowTitle}>{title}</strong>
        {detail && <small className={styles.rowDetail}>{detail}</small>}
        {meter}
      </span>
      <span className={`${styles.control} ${wide ? styles.controlWide : ""}`}>{children}</span>
    </div>
  );
}
