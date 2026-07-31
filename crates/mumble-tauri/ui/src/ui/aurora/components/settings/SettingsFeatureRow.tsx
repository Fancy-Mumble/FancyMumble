import type { ReactNode } from "react";
import styles from "../../AuroraClientSurfaces.module.css";

export interface SettingsFeatureRowProps {
  title: string;
  detail: string;
  children: ReactNode;
}

export default function SettingsFeatureRow({ title, detail, children }: SettingsFeatureRowProps) {
  return (
    <div className={styles.settingsFeature}>
      <span>
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
      {children}
    </div>
  );
}
