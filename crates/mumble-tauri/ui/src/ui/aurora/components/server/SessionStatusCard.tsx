import type { ReactNode } from "react";
import SessionStatusIndicator from "./SessionStatusIndicator";
import SessionStatusReason from "./SessionStatusReason";
import styles from "./SessionStatusScreen.module.css";

export interface SessionStatusCardProps {
  pending: boolean;
  title: string;
  server: string;
  reason: string | null;
  actions: ReactNode;
}

export default function SessionStatusCard({
  pending,
  title,
  server,
  reason,
  actions,
}: SessionStatusCardProps) {
  return (
    <div className={styles.screen}>
      <section className={styles.card}>
        <SessionStatusIndicator pending={pending} />
        <h2 className={styles.title}>{title}</h2>
        <p className={styles.server}>{server}</p>
        {reason && <SessionStatusReason message={reason} pending={pending} />}
        {actions}
      </section>
    </div>
  );
}
