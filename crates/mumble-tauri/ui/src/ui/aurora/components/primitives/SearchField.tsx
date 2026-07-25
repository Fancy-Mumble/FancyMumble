import type { InputHTMLAttributes } from "react";
import { CloseIcon, SearchIcon } from "@ui/icons";
import IconButton from "./IconButton";
import styles from "../../AuroraClientApp.module.css";

export interface SearchFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  /**
   * Renders a trailing icon button inside the field. Use it for the action that
   * dismisses whatever the search belongs to, so the surface needs no separate
   * button beside the field.
   */
  onDismiss?: () => void;
  /** Accessible name for the trailing button. */
  dismissLabel?: string;
}

export default function SearchField({ onDismiss, dismissLabel = "Close", className = "", ...props }: SearchFieldProps) {
  // A <button> is interactive content, so label activation is not forwarded to
  // the input from it - clicking the icon dismisses without stealing focus.
  return <label className={`${styles.search} ${onDismiss ? styles.searchDismissable : ""} ${className}`}>
    <SearchIcon />
    <input type="search" {...props} />
    {onDismiss && <IconButton icon={<CloseIcon />} label={dismissLabel} className={styles.searchDismiss} onClick={onDismiss} />}
  </label>;
}
