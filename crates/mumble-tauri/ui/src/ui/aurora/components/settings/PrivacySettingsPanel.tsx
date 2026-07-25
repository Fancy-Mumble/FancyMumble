import type { UserPreferences } from "@core/types";
import PreferenceToggleList from "./PreferenceToggleList";
import { sectionPreferenceKeys, type PreferenceToggleHandler } from "./settingsModel";

export interface PrivacySettingsPanelProps {
  prefs: UserPreferences;
  onToggle: PreferenceToggleHandler;
}

export default function PrivacySettingsPanel({ prefs, onToggle }: PrivacySettingsPanelProps) {
  return <PreferenceToggleList keys={sectionPreferenceKeys.privacy} prefs={prefs} onToggle={onToggle} />;
}
