import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import styles from "./Primitives.module.css";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost" | "bare";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  wrapLabel?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = "secondary", leadingIcon, trailingIcon, wrapLabel = true, className = "", children, type = "button", ...props }, ref) {
  return <button ref={ref} type={type} className={`${styles.button} ${className}`} data-variant={variant} {...props}>{leadingIcon && <span className={styles.buttonIcon}>{leadingIcon}</span>}{wrapLabel ? <span className={styles.buttonLabel}>{children}</span> : children}{trailingIcon && <span className={styles.buttonIcon}>{trailingIcon}</span>}</button>;
});

export default Button;
