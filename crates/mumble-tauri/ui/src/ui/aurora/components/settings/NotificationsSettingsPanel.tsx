import type { UserPreferences } from "@core/types";
import PreferenceToggleList from "./PreferenceToggleList";
import { sectionPreferenceKeys, type PreferenceToggleHandler } from "./settingsModel";

export interface NotificationsSettingsPanelProps {
  prefs: UserPreferences;
  onToggle: PreferenceToggleHandler;
}

export default function NotificationsSettingsPanel({ prefs, onToggle }: NotificationsSettingsPanelProps) {
  return <PreferenceToggleList keys={sectionPreferenceKeys.notifications} prefs={prefs} onToggle={onToggle} />;
}
