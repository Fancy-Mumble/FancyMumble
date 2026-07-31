import type { UserPreferences } from "@core/types";
import { SettingsGroup, SettingsToggleRow } from "./layout";
import { settingRows, type PreferenceToggleHandler } from "./settingsModel";

export interface PreferenceToggleListProps {
  keys: Array<keyof UserPreferences>;
  prefs: UserPreferences;
  onToggle: PreferenceToggleHandler;
  /** Heading for the band these toggles sit in. */
  title?: string;
  description?: string;
}

/** The boolean preferences named by `keys`, in the order `settingRows` declares. */
export default function PreferenceToggleList({
  keys,
  prefs,
  onToggle,
  title,
  description,
}: PreferenceToggleListProps) {
  return (
    <SettingsGroup title={title} description={description}>
      {settingRows
        .filter((row) => keys.includes(row.key))
        .map((row) => (
          <SettingsToggleRow
            key={row.key}
            title={row.title}
            detail={row.detail}
            checked={!!prefs[row.key]}
            onToggle={() => onToggle(row.key)}
          />
        ))}
    </SettingsGroup>
  );
}
