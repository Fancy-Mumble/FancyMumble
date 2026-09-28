import { forwardRef, type ReactNode, type TextareaHTMLAttributes } from "react";
import styles from "./TextAreaField.module.css";

export interface TextAreaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: ReactNode;
  error?: string;
}
const TextAreaField = forwardRef<HTMLTextAreaElement, TextAreaFieldProps>(function TextAreaField(
  { label, hint, error, className = "", id, ...props },
  ref,
) {
  const fieldId = id ?? `field-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <label className={`${styles.field} ${className}`} htmlFor={fieldId}>
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <textarea ref={ref} id={fieldId} aria-invalid={!!error} {...props} />
      {error && <em role="alert">{error}</em>}
    </label>
  );
});
export default TextAreaField;
