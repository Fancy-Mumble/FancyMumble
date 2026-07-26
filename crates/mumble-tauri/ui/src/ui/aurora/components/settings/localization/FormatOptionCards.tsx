import { Button } from "../../primitives";
import styles from "./Localization.module.css";

export interface FormatOptionCardsProps<T extends string> {
  title: string;
  hint: string;
  options: readonly T[];
  value: T;
  label: (option: T) => string;
  /** Rendered under the label so the option shows its own effect. */
  preview: (option: T) => string;
  onSelect: (option: T) => void;
}

/** A row of format choices, each previewing the output it produces. */
export default function FormatOptionCards<T extends string>({
  title,
  hint,
  options,
  value,
  label,
  preview,
  onSelect,
}: FormatOptionCardsProps<T>) {
  return (
    <div className={styles.group}>
      <strong className={styles.groupTitle}>{title}</strong>
      <small className={styles.groupHint}>{hint}</small>
      <div className={styles.cards}>
        {options.map((option) => (
          <Button
            key={option}
            variant="bare"
            wrapLabel={false}
            className={`${styles.card} ${option === value ? styles.cardSelected : ""}`}
            aria-pressed={option === value}
            onClick={() => onSelect(option)}
          >
            <span className={styles.cardLabel}>{label(option)}</span>
            <span className={styles.cardPreview}>{preview(option)}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}
