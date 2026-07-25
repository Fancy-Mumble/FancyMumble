import type { ReactNode } from "react";
import styles from "./ContextMenu.module.css";

export type ContextMenuTone = "default" | "danger";

export interface ContextMenuItemProps {
  children: ReactNode;
  /** Secondary line under the label, e.g. the current value of a setting. */
  hint?: ReactNode;
  /** Right-aligned adornment: a chevron, badge, or shortcut hint. */
  trailing?: ReactNode;
  tone?: ContextMenuTone;
  disabled?: boolean;
  onSelect?: () => void;
}

export default function ContextMenuItem({ children, hint, trailing, tone = "default", disabled, onSelect }: ContextMenuItemProps) {
  return <button type="button" className={styles.item} data-tone={tone} disabled={disabled} role="menuitem" onClick={onSelect}>
    <span className={styles.label}><span>{children}</span>{hint && <span className={styles.hint}>{hint}</span>}</span>
    {trailing && <span className={styles.trailing}>{trailing}</span>}
  </button>;
}
