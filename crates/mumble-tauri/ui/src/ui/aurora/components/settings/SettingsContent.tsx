import type { UserPreferences } from "@core/types";
import { Container } from "../primitives";
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
  onNavigate: (section: SettingsSectionId) => void;
}

export default function SettingsContent({
  section,
  prefs,
  onToggle,
  onPatch,
  onLocalChange,
  onNavigate,
}: SettingsContentProps) {
  return (
    <div className={styles.settingRows}>
      {/* The settings surface is full-screen by design, but a setting is a
          label and one control - stretched to 1800px the two ends stop reading
          as one row. Cap the column and centre it in whatever space is left. */}
      <Container maxWidth="lg" gutter={0}>
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
            onNavigate={onNavigate}
          />
        ) : (
          <div className={styles.blank}>Loading preferences…</div>
        )}
      </Container>
    </div>
  );
}
