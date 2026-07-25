import type { UserPreferences } from "@core/types";
import { SelectField, type SelectFieldOption } from "../primitives";
import type { PreferencePatchHandler } from "./settingsModel";
import styles from "../../SettingsPanel.module.css";

const TIME_FORMATS: SelectFieldOption[] = [
  { value: "auto", label: "Automatic" },
  { value: "12h", label: "12 hour" },
  { value: "24h", label: "24 hour" },
];

const DATE_FORMATS: SelectFieldOption[] = [
  { value: "auto", label: "Automatic" },
  { value: "dmy", label: "Day / month / year" },
  { value: "mdy", label: "Month / day / year" },
  { value: "ymd", label: "ISO year-month-day" },
];

const NUMBER_FORMATS: SelectFieldOption[] = [
  { value: "auto", label: "Automatic" },
  { value: "comma-period", label: "1,234.56" },
  { value: "period-comma", label: "1.234,56" },
  { value: "space-comma", label: "1 234,56" },
];

export interface LocalizationSettingsPanelProps {
  prefs: UserPreferences;
  onPatch: PreferencePatchHandler;
}

export default function LocalizationSettingsPanel({ prefs, onPatch }: LocalizationSettingsPanelProps) {
  return <div className={styles.form}>
    <SelectField label="Time format" value={prefs.timeFormat} options={TIME_FORMATS} onChange={(event) => void onPatch({ timeFormat: event.target.value as UserPreferences["timeFormat"] })} />
    <SelectField label="Date format" value={prefs.dateFormat ?? "auto"} options={DATE_FORMATS} onChange={(event) => void onPatch({ dateFormat: event.target.value as NonNullable<UserPreferences["dateFormat"]> })} />
    <SelectField label="Number format" value={prefs.numberFormat ?? "auto"} options={NUMBER_FORMATS} onChange={(event) => void onPatch({ numberFormat: event.target.value as NonNullable<UserPreferences["numberFormat"]> })} />
  </div>;
}
