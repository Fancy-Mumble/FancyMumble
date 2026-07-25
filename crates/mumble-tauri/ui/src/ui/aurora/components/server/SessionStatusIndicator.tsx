import { WarningIcon } from "@ui/icons";
import styles from "./SessionStatusScreen.module.css";

export interface SessionStatusIndicatorProps {
  pending: boolean;
}

export default function SessionStatusIndicator({ pending }: SessionStatusIndicatorProps) {
  return (
    <div className={`${styles.indicator} ${pending ? styles.indicatorPending : ""}`} aria-hidden="true">
      {pending ? <span className={styles.spinner} /> : <WarningIcon />}
    </div>
  );
}
