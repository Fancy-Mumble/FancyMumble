import type { ComponentType } from "react";
import styles from "./RadioCardGroup.module.css";

export interface RadioCardOption<T extends string> {
  value: T;
  label: string;
  description: string;
  Icon: ComponentType<{ width?: number; height?: number; className?: string }>;
}

export function RadioCardGroup<T extends string>({
  name,
  options,
  value,
  onChange,
}: Readonly<{
  name: string;
  options: readonly RadioCardOption<T>[];
  value: T;
  onChange: (value: T) => void;
}>) {
  return (
    <div className={styles.grid}>
      {options.map(({ value: optValue, label, description, Icon }) => {
        const active = value === optValue;
        return (
          <label
            key={optValue}
            className={`${styles.card} ${active ? styles.cardActive : ""}`}
          >
            <input
              type="radio"
              name={name}
              className={styles.radio}
              aria-label={label}
              checked={active}
              onChange={() => onChange(optValue)}
            />
            <Icon className={styles.icon} width={22} height={22} />
            <span className={styles.title}>{label}</span>
            <span className={styles.description}>{description}</span>
          </label>
        );
      })}
    </div>
  );
}
