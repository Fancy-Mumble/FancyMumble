import type { ButtonHTMLAttributes, ReactNode } from "react";
import Button from "./Button";
import styles from "./Primitives.module.css";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: ReactNode;
  label: string;
}

export default function IconButton({ icon, label, className = "", ...props }: IconButtonProps) {
  return (
    <Button
      variant="bare"
      wrapLabel={false}
      className={`${styles.iconButton} ${className}`}
      aria-label={label}
      title={props.title ?? label}
      {...props}
    >
      {icon}
    </Button>
  );
}
