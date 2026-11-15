import styles from "./Privacy.module.css";

export type PrivacyWarningTone = "danger" | "caution" | "muted";

export interface PrivacyWarningProps {
  tone: PrivacyWarningTone;
  heading: string;
  body: string;
}

/** A risk note attached to a privacy toggle. */
export default function PrivacyWarning({ tone, heading, body }: PrivacyWarningProps) {
  return (
    <div className={`${styles.banner} ${styles[tone]}`} role="note">
      <span>{heading}</span>
      <p>{body}</p>
    </div>
  );
}
