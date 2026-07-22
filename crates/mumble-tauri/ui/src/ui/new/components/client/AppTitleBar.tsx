import type { ReactNode } from "react";
import { SparklesIcon } from "@ui/icons";
import { Button, IconButton } from "../primitives";
import styles from "../../NewClientApp.module.css";

export interface TitleBarAction {
  id: string;
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  iconOnly?: boolean;
}

export default function AppTitleBar({ serverTitle, actions }: { serverTitle?: string; actions: readonly TitleBarAction[] }) {
  return <header className={styles.titlebar} data-tauri-drag-region><span className={styles.appMark}><SparklesIcon /></span><strong>Fancy Mumble</strong>{serverTitle && <span className={styles.serverTitle}>{serverTitle}</span>}<div className={styles.titleActions}>{actions.map((action) => action.iconOnly ? <IconButton key={action.id} icon={action.icon} label={action.label} onClick={action.onClick} disabled={action.disabled} /> : <Button key={action.id} variant="bare" leadingIcon={action.icon} onClick={action.onClick} disabled={action.disabled}>{action.label}</Button>)}</div></header>;
}
