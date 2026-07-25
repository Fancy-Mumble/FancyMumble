import type { UserPreferences } from "@core/types";
import { SelectField, TextField, type SelectFieldOption } from "../primitives";
import PreferenceToggleList from "./PreferenceToggleList";
import { sectionPreferenceKeys, type LocalPreferenceHandler, type PreferencePatchHandler, type PreferenceToggleHandler } from "./settingsModel";
import styles from "../../SettingsPanel.module.css";

const FEATURE_LEVELS: SelectFieldOption[] = [
  { value: "normal", label: "Normal" },
  { value: "expert", label: "Expert" },
  { value: "developer", label: "Developer" },
];

export interface GeneralSettingsPanelProps {
  prefs: UserPreferences;
  onToggle: PreferenceToggleHandler;
  onPatch: PreferencePatchHandler;
  onLocalChange: LocalPreferenceHandler;
}

export default function GeneralSettingsPanel({ prefs, onToggle, onPatch, onLocalChange }: GeneralSettingsPanelProps) {
  return <>
    <PreferenceToggleList keys={sectionPreferenceKeys.general} prefs={prefs} onToggle={onToggle} />
    <div className={styles.form}>
      <TextField label="Default username" value={prefs.defaultUsername} onChange={(event) => onLocalChange({ defaultUsername: event.target.value })} onBlur={() => void onPatch({ defaultUsername: prefs.defaultUsername })} />
      <SelectField label="Feature level" value={prefs.userMode} options={FEATURE_LEVELS} onChange={(event) => void onPatch({ userMode: event.target.value as UserPreferences["userMode"] })} />
    </div>
  </>;
}
