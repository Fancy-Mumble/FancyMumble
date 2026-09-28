import { Button, ToggleSwitch } from "../../primitives";
import SettingsRow from "./SettingsRow";

export interface SettingsToggleRowProps {
  title: string;
  detail?: string;
  checked: boolean;
  onToggle: () => void;
}

/** A setting that is simply on or off. */
export default function SettingsToggleRow({ title, detail, checked, onToggle }: SettingsToggleRowProps) {
  return (
    <SettingsRow title={title} detail={detail}>
      <Button
        variant="bare"
        wrapLabel={false}
        role="switch"
        aria-checked={checked}
        aria-label={title}
        onClick={onToggle}
      >
        <ToggleSwitch on={checked} />
      </Button>
    </SettingsRow>
  );
}
