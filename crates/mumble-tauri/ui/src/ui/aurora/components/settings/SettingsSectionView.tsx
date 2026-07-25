import type { UserPreferences } from "@core/types";
import AppearanceSettings from "./AppearanceSettings";
import AdvancedSettingsPanel from "./AdvancedSettingsPanel";
import GeneralSettingsPanel from "./GeneralSettingsPanel";
import LocalizationSettingsPanel from "./LocalizationSettingsPanel";
import NotificationsSettingsPanel from "./NotificationsSettingsPanel";
import PluginTrustSettings from "./PluginTrustSettings";
import PrivacySettingsPanel from "./PrivacySettingsPanel";
import ProfileIdentitySettings from "./ProfileIdentitySettings";
import ShortcutSettings from "./ShortcutSettings";
import VoiceSettingsPanel from "./VoiceSettingsPanel";
import type { LocalPreferenceHandler, PreferencePatchHandler, PreferenceToggleHandler, SettingsSectionId } from "./settingsModel";

export interface SettingsSectionViewProps {
  section: SettingsSectionId;
  prefs: UserPreferences;
  onToggle: PreferenceToggleHandler;
  onPatch: PreferencePatchHandler;
  onLocalChange: LocalPreferenceHandler;
}

export default function SettingsSectionView({ section, prefs, onToggle, onPatch, onLocalChange }: SettingsSectionViewProps) {
  switch (section) {
    case "general":
      return <GeneralSettingsPanel prefs={prefs} onToggle={onToggle} onPatch={onPatch} onLocalChange={onLocalChange} />;
    case "profile":
      return <ProfileIdentitySettings />;
    case "voice":
      return <VoiceSettingsPanel />;
    case "shortcuts":
      return <ShortcutSettings />;
    case "notifications":
      return <NotificationsSettingsPanel prefs={prefs} onToggle={onToggle} />;
    case "localization":
      return <LocalizationSettingsPanel prefs={prefs} onPatch={onPatch} />;
    case "privacy":
      return <PrivacySettingsPanel prefs={prefs} onToggle={onToggle} />;
    case "plugins":
      return <PluginTrustSettings />;
    case "appearance":
      return <AppearanceSettings />;
    case "advanced":
      return <AdvancedSettingsPanel prefs={prefs} onToggle={onToggle} onPatch={onPatch} onLocalChange={onLocalChange} />;
  }
}
