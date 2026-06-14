import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import styles from "./LoadingSplash.module.css";
import enCommon from "../../locales/en/common.json";

export const __TEST_FUNNY_MESSAGES: readonly string[] = (enCommon as unknown as { loadingSplash: { messages: string[] } }).loadingSplash.messages;

export interface LoadingSplashProps {
  /** Override the headline.  Defaults to the brand name. */
  title?: string;
  /** Pin a specific subtitle.  When omitted, rotates through the
   *  localised funny messages every ~1.8s. */
  message?: string;
}

/** Centered loading splash with a spinner and a rotating funny line.
 *  Use as a Suspense fallback or while initial async setup runs. */
export default function LoadingSplash({ title, message }: LoadingSplashProps) {
  const { t } = useTranslation("common");
  const messages = t("loadingSplash.messages", { returnObjects: true }) as string[];
  const [tick, setTick] = useState(() => Math.floor(Math.random() * messages.length));

  useEffect(() => {
    if (message !== undefined) return undefined;
    const id = window.setInterval(() => {
      setTick((prev) => (prev + 1) % messages.length);
    }, 1800);
    return () => window.clearInterval(id);
  }, [message, messages.length]);

  const subtitle = message ?? messages[tick];
  const heading = title ?? t("brand");

  return (
    <div className={styles.root} role="status" aria-live="polite">
      <div className={styles.spinner} aria-hidden="true" />
      <div className={styles.title}>{heading}</div>
      <div className={styles.subtitle}>{subtitle}</div>
    </div>
  );
}
