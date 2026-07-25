import type { UserPreferences } from "@core/types";
import SettingsSectionHeader from "./SettingsSectionHeader";
import SettingsSectionView from "./SettingsSectionView";
import {
  sectionLabel,
  type LocalPreferenceHandler,
  type PreferencePatchHandler,
  type PreferenceToggleHandler,
  type SettingsSectionId,
} from "./settingsModel";
import styles from "../../AuroraClientSurfaces.module.css";

export interface SettingsContentProps {
  section: SettingsSectionId;
  prefs: UserPreferences | null;
  onToggle: PreferenceToggleHandler;
  onPatch: PreferencePatchHandler;
  onLocalChange: LocalPreferenceHandler;
}

export default function SettingsContent({
  section,
  prefs,
  onToggle,
  onPatch,
  onLocalChange,
}: SettingsContentProps) {
  return (
    <div className={styles.settingRows}>
      <SettingsSectionHeader
        title={sectionLabel(section)}
        description="Preferences apply to both visual implementations."
      />
      {prefs ? (
        <SettingsSectionView
          section={section}
          prefs={prefs}
          onToggle={onToggle}
          onPatch={onPatch}
          onLocalChange={onLocalChange}
        />
      ) : (
        <div className={styles.blank}>Loading preferences…</div>
      )}
    </div>
  );
}
