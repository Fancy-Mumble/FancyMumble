import { useId } from "react";
import styles from "./SettingsLayout.module.css";

export interface SettingsRadioOption<T extends string | number> {
  value: T;
  label: string;
}

export interface SettingsRadioGroupProps<T extends string | number> {
  options: readonly SettingsRadioOption<T>[];
  value: T;
  onSelect: (value: T) => void;
  label: string;
}

/**
 * A short list of bare values on one line.
 *
 * For choices where the options need no explanation and seeing them all at once
 * is the point - packet sizes, sample rates.
 */
export default function SettingsRadioGroup<T extends string | number>({
  options,
  value,
  onSelect,
  label,
}: SettingsRadioGroupProps<T>) {
  const name = useId();
  return (
    <div className={styles.radios} role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <label key={option.value} className={styles.radio}>
          <input
            type="radio"
            name={name}
            checked={option.value === value}
            onChange={() => onSelect(option.value)}
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}
