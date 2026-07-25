import type { UserPreferences } from "@core/types";
import PreferenceToggleRow from "./PreferenceToggleRow";
import { settingRows, type PreferenceToggleHandler } from "./settingsModel";

export interface PreferenceToggleListProps {
  keys: Array<keyof UserPreferences>;
  prefs: UserPreferences;
  onToggle: PreferenceToggleHandler;
}

export default function PreferenceToggleList({ keys, prefs, onToggle }: PreferenceToggleListProps) {
  return (
    <>
      {settingRows
        .filter((row) => keys.includes(row.key))
        .map((row) => (
          <PreferenceToggleRow
            key={row.key}
            title={row.title}
            detail={row.detail}
            checked={!!prefs[row.key]}
            onToggle={() => onToggle(row.key)}
          />
        ))}
    </>
  );
}
