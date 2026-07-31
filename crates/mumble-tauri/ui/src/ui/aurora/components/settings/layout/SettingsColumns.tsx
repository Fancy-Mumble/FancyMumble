import type { ReactNode } from "react";
import styles from "./SettingsLayout.module.css";

export interface SettingsColumnsProps {
  children: ReactNode;
}

/**
 * Places sibling fields side by side, collapsing to one column when narrow.
 *
 * For pairs that are read together - input and output device, threshold and
 * hold - where stacking them implies an order that isn't there.
 */
export default function SettingsColumns({ children }: SettingsColumnsProps) {
  return <div className={styles.columns}>{children}</div>;
}
