import type { ReactNode } from "react";
import styles from "./designSheetLayout.module.css";

export interface SectionProps {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}

/** One numbered chapter of the design sheet. */
export default function Section({ id, eyebrow, title, description, children }: SectionProps) {
  return (
    <section id={id} className={styles.section}>
      <header className={styles.sectionHeader}>
        <div>
          <span className={styles.eyebrow}>{eyebrow}</span>
          <h2>{title}</h2>
        </div>
        <p>{description}</p>
      </header>
      {children}
    </section>
  );
}
