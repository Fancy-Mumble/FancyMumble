import { useMemo } from "react";
import { Box, MenuItem, TextField } from "@mui/material";
import { useTranslation } from "react-i18next";
import GB from "country-flag-icons/react/3x2/GB";
import DE from "country-flag-icons/react/3x2/DE";
import FR from "country-flag-icons/react/3x2/FR";
import CN from "country-flag-icons/react/3x2/CN";
import { BUILT_IN_LANGUAGES, type BuiltInLanguage } from "@core/i18n";
import type { DateFormat, NumberFormat, TimeFormat } from "@core/types";
// The previews are format logic, not layout: what "dmy" renders as is the same
// answer in every design, so Nebula asks Standard rather than deriving it again.
import { previewDate, previewNumber, previewTime } from "@standard/pages/settings/LocalizationPanel";
import { Stack } from "../primitives";
import { Field, GroupRule, GroupTitle, OptionCardGrid, PageTitle, ToggleRow } from "./controls";
import { usePreferenceSettings } from "./usePreferenceSettings";
import { radius } from "../../tokens";

/** Always shown in the language itself, so it is findable from any UI locale. */
const NATIVE_LANGUAGE_NAMES: Record<BuiltInLanguage, string> = {
  en: "English",
  de: "Deutsch",
  fr: "Français",
  zh: "中文",
};

/** The language's origin country where several regions share one language. */
const LANGUAGE_FLAGS: Record<BuiltInLanguage, typeof GB> = { en: GB, de: DE, fr: FR, zh: CN };

const TIME_FORMATS: TimeFormat[] = ["auto", "12h", "24h"];
const DATE_FORMATS: DateFormat[] = ["auto", "dmy", "mdy", "ymd"];
const NUMBER_FORMATS: NumberFormat[] = ["auto", "comma-period", "period-comma", "space-comma"];

/**
 * The Language & format page.
 *
 * Each format choice shows a sample rendered the way that choice would render
 * it, because the option names ("dmy", "space-comma") describe a convention the
 * user is trying to recognise rather than one they can read off.
 */
export function LocalizationSettings() {
  const { t, i18n } = useTranslation("settings");
  const { prefs, set, toggle } = usePreferenceSettings();
  const locale = i18n.resolvedLanguage ?? "en";
  // Fixed on mount so the previews do not tick over as the clock moves.
  const sample = useMemo(() => new Date(), []);

  if (!prefs) return null;

  return (
    <Box sx={{ maxWidth: 640 }}>
      <PageTitle title={t("localization.title")} />

      <Field label={t("language.label")}>
        <TextField
          select
          fullWidth
          size="small"
          value={locale in NATIVE_LANGUAGE_NAMES ? locale : "en"}
          onChange={(event) => void i18n.changeLanguage(event.target.value)}
          helperText={t("language.description")}
          slotProps={{ htmlInput: { "aria-label": t("language.label") } }}
        >
          {BUILT_IN_LANGUAGES.map((language) => {
            const Flag = LANGUAGE_FLAGS[language];
            return (
              <MenuItem key={language} value={language}>
                <Stack direction="row" alignItems="center" gap={1.25}>
                  <Flag style={{ width: 20, height: 15, borderRadius: radius("sm"), display: "block" }} />
                  {NATIVE_LANGUAGE_NAMES[language]}
                </Stack>
              </MenuItem>
            );
          })}
        </TextField>
      </Field>

      <GroupRule />

      <GroupTitle hint={t("time.description")}>{t("time.title")}</GroupTitle>
      <OptionCardGrid
        ariaLabel={t("time.formatLabel")}
        value={prefs.timeFormat}
        onChange={(timeFormat) => set({ timeFormat })}
        options={TIME_FORMATS.map((id) => ({
          id,
          label: t(`time.format.${id}`),
          preview: previewTime(id, locale, sample),
        }))}
      />
      <Box sx={{ mt: "14px" }}>
        <ToggleRow
          title={t("time.localLabel")}
          hint={t("time.localDescription")}
          checked={prefs.convertToLocalTime}
          onChange={() => toggle("convertToLocalTime")}
        />
      </Box>

      <GroupRule />

      <GroupTitle hint={t("date.description")}>{t("date.title")}</GroupTitle>
      <OptionCardGrid
        ariaLabel={t("date.title")}
        columns={4}
        value={prefs.dateFormat}
        onChange={(dateFormat) => set({ dateFormat })}
        options={DATE_FORMATS.map((id) => ({
          id,
          label: t(`date.format.${id}`),
          preview: previewDate(id, locale, sample),
        }))}
      />

      <GroupRule />

      <GroupTitle hint={t("number.description")}>{t("number.title")}</GroupTitle>
      <OptionCardGrid
        ariaLabel={t("number.title")}
        columns={2}
        value={prefs.numberFormat}
        onChange={(numberFormat) => set({ numberFormat })}
        options={NUMBER_FORMATS.map((id) => ({
          id,
          label: t(`number.format.${id}`),
          preview: previewNumber(id, locale),
        }))}
      />
    </Box>
  );
}
