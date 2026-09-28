import { forwardRef, type ReactNode, type SelectHTMLAttributes } from "react";
import styles from "./Primitives.module.css";

export interface SelectFieldOption {
  value: string;
  label: string;
}

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  hint?: ReactNode;
  options: SelectFieldOption[];
}

const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { label, hint, options, className = "", id, ...props },
  ref,
) {
  const selectId = id ?? `select-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <label className={`${styles.select} ${className}`} htmlFor={selectId}>
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <select ref={ref} id={selectId} {...props}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
});

export default SelectField;
