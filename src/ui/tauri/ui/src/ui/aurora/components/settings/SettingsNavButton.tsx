import { Button } from "../primitives";
import styles from "../../AuroraClientSurfaces.module.css";

export interface SettingsNavButtonProps {
  label: string;
  active: boolean;
  onSelect: () => void;
}

export default function SettingsNavButton({ label, active, onSelect }: SettingsNavButtonProps) {
  return (
    <Button variant="bare" className={active ? styles.settingsActive : undefined} onClick={onSelect}>
      {label}
    </Button>
  );
}
