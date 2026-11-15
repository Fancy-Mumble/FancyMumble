import type { ReactNode } from "react";
import styles from "./SettingsLayout.module.css";

export interface SettingsGroupProps {
  /** Omit for a group that only needs the spacing, not a heading. */
  title?: string;
  description?: string;
  children: ReactNode;
}

/**
 * A titled band of related settings.
 *
 * Grouping is what turns a settings panel from a list into a screen: the
 * heading tells you whether the next six rows are worth reading at all.
 */
export default function SettingsGroup({ title, description, children }: SettingsGroupProps) {
  return (
    <section className={styles.group}>
      {title && <strong className={styles.groupTitle}>{title}</strong>}
      {description && <small className={styles.groupDescription}>{description}</small>}
      <div className={styles.rows}>{children}</div>
    </section>
  );
}
