import { Button, ToggleSwitch } from "../primitives";
import styles from "../../AuroraClientSurfaces.module.css";

export interface PreferenceToggleRowProps {
  title: string;
  detail: string;
  checked: boolean;
  onToggle: () => void;
}

export default function PreferenceToggleRow({ title, detail, checked, onToggle }: PreferenceToggleRowProps) {
  return <Button variant="bare" wrapLabel={false} className={styles.settingRow} onClick={onToggle}>
    <span><strong>{title}</strong><small>{detail}</small></span>
    <ToggleSwitch on={checked} />
  </Button>;
}
