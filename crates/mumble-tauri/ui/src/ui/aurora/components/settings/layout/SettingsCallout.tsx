import type { ReactNode } from "react";
import styles from "./SettingsLayout.module.css";

export type SettingsCalloutTone = "info" | "warn" | "danger";

export interface SettingsCalloutProps {
  tone?: SettingsCalloutTone;
  title: string;
  children: ReactNode;
}

const TONE_CLASS: Record<SettingsCalloutTone, string> = {
  info: styles.calloutInfo,
  warn: styles.calloutWarn,
  danger: styles.calloutDanger,
};

/** A standing notice inside a settings group. */
export default function SettingsCallout({ tone = "info", title, children }: SettingsCalloutProps) {
  return (
    <div className={`${styles.callout} ${TONE_CLASS[tone]}`} role="note">
      <strong className={styles.calloutTitle}>{title}</strong>
      <p className={styles.calloutBody}>{children}</p>
    </div>
  );
}
