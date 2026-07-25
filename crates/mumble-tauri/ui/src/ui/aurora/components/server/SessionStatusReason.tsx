import styles from "./SessionStatusScreen.module.css";

export interface SessionStatusReasonProps {
  message: string;
  /** Progress updates are informational; failures are announced as alerts. */
  pending: boolean;
}

export default function SessionStatusReason({ message, pending }: SessionStatusReasonProps) {
  return <p className={`${styles.reason} ${pending ? styles.reasonPending : ""}`} role={pending ? "status" : "alert"}>{message}</p>;
}
