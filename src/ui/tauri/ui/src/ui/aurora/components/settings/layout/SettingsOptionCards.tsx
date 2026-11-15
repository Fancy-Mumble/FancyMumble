import type { ReactNode } from "react";
import { Button } from "../../primitives";
import styles from "./SettingsLayout.module.css";

export interface SettingsOption<T extends string | number> {
  value: T;
  label: string;
  /** Says what picking this actually does. Worth writing - it is why the option is a card. */
  description?: string;
  icon?: ReactNode;
}

export interface SettingsOptionCardsProps<T extends string | number> {
  options: readonly SettingsOption<T>[];
  value: T;
  onSelect: (value: T) => void;
  /** Names the group for assistive tech, since the cards are buttons, not a select. */
  label: string;
}

/**
 * A choice between a few options, each with room to explain itself.
 *
 * A dropdown hides every option but one and has nowhere to put a description,
 * which is wrong when the choice is consequential and the names alone are
 * jargon ("RNNoise", "OMLSA + IMCRA").
 */
export default function SettingsOptionCards<T extends string | number>({
  options,
  value,
  onSelect,
  label,
}: SettingsOptionCardsProps<T>) {
  return (
    <div className={styles.cards} role="group" aria-label={label}>
      {options.map((option) => (
        <Button
          key={option.value}
          variant="bare"
          wrapLabel={false}
          className={`${styles.card} ${option.value === value ? styles.cardSelected : ""}`}
          aria-pressed={option.value === value}
          onClick={() => onSelect(option.value)}
        >
          {option.icon && <span className={styles.cardIcon}>{option.icon}</span>}
          <span className={styles.cardTitle}>{option.label}</span>
          {option.description && <span className={styles.cardText}>{option.description}</span>}
        </Button>
      ))}
    </div>
  );
}
