import styles from "./ContextMenu.module.css";

/** Divider between groups of related menu items. */
export default function ContextMenuSeparator() {
  return <div className={styles.separator} role="separator" />;
}
