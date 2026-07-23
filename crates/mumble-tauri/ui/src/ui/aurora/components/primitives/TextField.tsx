import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import styles from "./Primitives.module.css";

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: ReactNode;
  error?: string;
}

const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField({ label, hint, error, className = "", id, ...props }, ref) {
  const inputId = id ?? `field-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return <label className={`${styles.field} ${className}`} htmlFor={inputId}><span>{label}{hint && <small>{hint}</small>}</span><input ref={ref} id={inputId} aria-invalid={!!error} {...props} />{error && <em role="alert">{error}</em>}</label>;
});

export default TextField;
