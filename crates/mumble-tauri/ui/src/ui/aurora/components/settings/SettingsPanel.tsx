import { useEffect, useState } from "react";
import { getPreferences, updatePreferences } from "@core/preferencesStorage";
import { useAppStore } from "@core/store";
import type { UserPreferences } from "@core/types";
import { ModalSurface } from "../primitives";
import SettingsContent from "./SettingsContent";
import SettingsNav from "./SettingsNav";
import type { SettingsSectionId } from "./settingsModel";
import styles from "../../AuroraClientSurfaces.module.css";

export interface SettingsPanelProps {
  onClose: () => void;
}

export default function SettingsPanel({ onClose }: SettingsPanelProps) {
  const [prefs, setPrefs] = useState<UserPreferences | null>(null);
  const [section, setSection] = useState<SettingsSectionId>("general");
  const [query, setQuery] = useState("");
  useEffect(() => {
    void getPreferences()
      .then(setPrefs)
      .catch(() => undefined);
  }, []);

  const toggle = async (key: keyof UserPreferences) => {
    if (!prefs || typeof prefs[key] !== "boolean") return;
    const next = await updatePreferences({ [key]: !prefs[key] });
    setPrefs(next);
    if (key === "disableLinkPreviews")
      useAppStore.setState({ disableLinkPreviews: next.disableLinkPreviews ?? false });
    if (key === "enableExternalEmbeds")
      useAppStore.setState({ enableExternalEmbeds: next.enableExternalEmbeds ?? false });
    if (key === "streamerMode") useAppStore.setState({ streamerMode: next.streamerMode ?? false });
  };
  const patchPreference = async (change: Partial<UserPreferences>) =>
    setPrefs(await updatePreferences(change));
  const updateLocalPrefs = (change: Partial<UserPreferences>) =>
    setPrefs((prev) => (prev ? { ...prev, ...change } : prev));

  const selectSection = (id: SettingsSectionId) => {
    setSection(id);
    setQuery("");
  };

  return (
    <ModalSurface
      title="Settings"
      eyebrow="CLIENT PREFERENCES"
      onClose={onClose}
      className={styles.settingsSurface}
      backdropClassName={styles.settingsBackdrop}
    >
      <div className={styles.settingsGrid}>
        <SettingsNav section={section} query={query} onQueryChange={setQuery} onSelect={selectSection} />
        <SettingsContent
          section={section}
          prefs={prefs}
          onToggle={(key) => void toggle(key)}
          onPatch={patchPreference}
          onLocalChange={updateLocalPrefs}
          onNavigate={selectSection}
        />
      </div>
    </ModalSurface>
  );
}
