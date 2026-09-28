import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { DateFormat, NumberFormat, TimeFormat, UserPreferences } from "@core/types";
import { SettingsToggleRow } from "../layout";
import type { PreferencePatchHandler, PreferenceToggleHandler } from "../settingsModel";
import FormatOptionCards from "./FormatOptionCards";
import LanguagePicker from "./LanguagePicker";
import {
  DATE_FORMAT_LABELS,
  DATE_FORMAT_OPTIONS,
  NUMBER_FORMAT_LABELS,
  NUMBER_FORMAT_OPTIONS,
  TIME_FORMAT_LABELS,
  TIME_FORMAT_OPTIONS,
  previewDate,
  previewNumber,
  previewTime,
} from "./formatPreview";

export interface LocalizationSettingsPanelProps {
  prefs: UserPreferences;
  onPatch: PreferencePatchHandler;
  onToggle: PreferenceToggleHandler;
}

/** Language, and how times, dates and numbers are written. */
export default function LocalizationSettingsPanel({
  prefs,
  onPatch,
  onToggle,
}: LocalizationSettingsPanelProps) {
  const { i18n } = useTranslation("settings");
  const locale = i18n.resolvedLanguage ?? "en";
  // Frozen per mount so the previews don't tick while the panel is open.
  const sample = useMemo(() => new Date(), []);

  return (
    <>
      <LanguagePicker />

      <FormatOptionCards<TimeFormat>
        title="Time format"
        hint="How clock times are written."
        options={TIME_FORMAT_OPTIONS}
        value={prefs.timeFormat}
        label={(option) => TIME_FORMAT_LABELS[option]}
        preview={(option) => previewTime(option, locale, sample)}
        onSelect={(timeFormat) => void onPatch({ timeFormat })}
      />

      <SettingsToggleRow
        title="Convert to local time"
        detail="Show timestamps in this device's time zone rather than the sender's."
        checked={prefs.convertToLocalTime}
        onToggle={() => onToggle("convertToLocalTime")}
      />

      <FormatOptionCards<DateFormat>
        title="Date format"
        hint="The order of day, month and year."
        options={DATE_FORMAT_OPTIONS}
        value={prefs.dateFormat ?? "auto"}
        label={(option) => DATE_FORMAT_LABELS[option]}
        preview={(option) => previewDate(option, locale, sample)}
        onSelect={(dateFormat) => void onPatch({ dateFormat })}
      />

      <FormatOptionCards<NumberFormat>
        title="Number format"
        hint="Which separators group digits and mark decimals."
        options={NUMBER_FORMAT_OPTIONS}
        value={prefs.numberFormat ?? "auto"}
        label={(option) => NUMBER_FORMAT_LABELS[option]}
        preview={(option) => previewNumber(option, locale)}
        onSelect={(numberFormat) => void onPatch({ numberFormat })}
      />
    </>
  );
}
