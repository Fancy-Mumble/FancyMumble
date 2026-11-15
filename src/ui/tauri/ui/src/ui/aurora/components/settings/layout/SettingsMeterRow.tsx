import type { ReactNode } from "react";
import SettingsRow from "./SettingsRow";
import styles from "./SettingsLayout.module.css";

export interface SettingsMeterRowProps {
  title: string;
  detail?: string;
  /** 0-1. Clamped, so a caller cannot overflow the track. */
  level: number;
  children: ReactNode;
}

/** A setting whose feedback is a live level, not a value - mic tests, playback. */
export default function SettingsMeterRow({ title, detail, level, children }: SettingsMeterRowProps) {
  const percent = Math.max(0, Math.min(1, level)) * 100;
  return (
    <SettingsRow
      title={title}
      detail={detail}
      meter={
        <span className={styles.meter} role="meter" aria-valuenow={Math.round(percent)} aria-label={title}>
          <span className={styles.meterFill} style={{ width: `${percent}%` }} />
        </span>
      }
    >
      {children}
    </SettingsRow>
  );
}
