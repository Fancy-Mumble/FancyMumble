import type { UserPreferences } from "@core/types";
import { SelectField, TextField, type SelectFieldOption } from "../primitives";
import PreferenceToggleList from "./PreferenceToggleList";
import ResetApplicationRow from "./ResetApplicationRow";
import {
  sectionPreferenceKeys,
  type LocalPreferenceHandler,
  type PreferencePatchHandler,
  type PreferenceToggleHandler,
} from "./settingsModel";
import styles from "../../SettingsPanel.module.css";

const LOG_LEVELS: SelectFieldOption[] = [
  { value: "error", label: "Error" },
  { value: "warn", label: "Warning" },
  { value: "info", label: "Information" },
  { value: "debug", label: "Debug" },
  { value: "trace", label: "Trace" },
];

const WELCOME_MODES: SelectFieldOption[] = [
  { value: "hide", label: "Hide" },
  { value: "once", label: "Once per server" },
  { value: "always", label: "Every connection" },
];

export interface AdvancedSettingsPanelProps {
  prefs: UserPreferences;
  onToggle: PreferenceToggleHandler;
  onPatch: PreferencePatchHandler;
  onLocalChange: LocalPreferenceHandler;
}

export default function AdvancedSettingsPanel({
  prefs,
  onToggle,
  onPatch,
  onLocalChange,
}: AdvancedSettingsPanelProps) {
  return (
    <>
      <PreferenceToggleList keys={sectionPreferenceKeys.advanced} prefs={prefs} onToggle={onToggle} />
      <div className={styles.form}>
        <TextField
          label="Klipy API key"
          type="password"
          value={prefs.klipyApiKey ?? ""}
          onChange={(event) => onLocalChange({ klipyApiKey: event.target.value })}
          onBlur={() => void onPatch({ klipyApiKey: prefs.klipyApiKey })}
        />
        <TextField
          label="Marketplace API URL"
          value={prefs.marketplaceBaseUrl ?? ""}
          placeholder="Use the production marketplace"
          onChange={(event) => onLocalChange({ marketplaceBaseUrl: event.target.value })}
          onBlur={() => void onPatch({ marketplaceBaseUrl: prefs.marketplaceBaseUrl || undefined })}
        />
        <SelectField
          label="Log level"
          value={prefs.logLevel ?? "info"}
          options={LOG_LEVELS}
          onChange={(event) => void onPatch({ logLevel: event.target.value })}
        />
        <SelectField
          label="Welcome messages"
          value={prefs.welcomeMessageDisplay ?? "once"}
          options={WELCOME_MODES}
          onChange={(event) =>
            void onPatch({
              welcomeMessageDisplay: event.target.value as NonNullable<
                UserPreferences["welcomeMessageDisplay"]
              >,
            })
          }
        />
        <ResetApplicationRow />
      </div>
    </>
  );
}
