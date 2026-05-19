import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import GB from "country-flag-icons/react/3x2/GB";
import DE from "country-flag-icons/react/3x2/DE";
import FR from "country-flag-icons/react/3x2/FR";
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "../../i18n";
import type { TimeFormat, DateFormat, NumberFormat } from "../../types";
import { Autocomplete, type AutocompleteOption } from "../../components/elements/Autocomplete";
import { Toggle } from "./SharedControls";
import styles from "./SettingsPage.module.css";

/** Native names for the supported UI languages (always shown in the
 *  language itself so users can find their language regardless of
 *  the current UI locale). */
const NATIVE_LANGUAGE_NAMES: Record<SupportedLanguage, string> = {
  en: "English",
  de: "Deutsch",
  fr: "Français",
};

/** Flag chosen per language. Where multiple regions share a language
 *  we pick the language's origin country (English -> UK, German -> DE).
 *  Typed against `typeof GB` so any future language must use the same
 *  FlagComponent signature country-flag-icons exposes. */
const LANGUAGE_FLAGS: Record<SupportedLanguage, typeof GB> = {
  en: GB,
  de: DE,
  fr: FR,
};

const FLAG_STYLE: React.CSSProperties = { width: 22, height: 16, borderRadius: 2, display: "block" };

const TIME_FORMAT_OPTIONS: TimeFormat[] = ["auto", "12h", "24h"];
const DATE_FORMAT_OPTIONS: DateFormat[] = ["auto", "dmy", "mdy", "ymd"];
const NUMBER_FORMAT_OPTIONS: NumberFormat[] = [
  "auto",
  "comma-period",
  "period-comma",
  "space-comma",
];

const SAMPLE_NUMBER = 1234567.89;

function previewTime(format: TimeFormat, locale: string, sample: Date): string {
  if (format === "auto") {
    return new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(sample);
  }
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: format === "12h",
  }).format(sample);
}

function previewDate(format: DateFormat, locale: string, sample: Date): string {
  switch (format) {
    case "auto":
      return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(sample);
    case "dmy":
      // en-GB always renders as DD/MM/YYYY regardless of UI language.
      return new Intl.DateTimeFormat("en-GB").format(sample);
    case "mdy":
      // en-US always renders as MM/DD/YYYY.
      return new Intl.DateTimeFormat("en-US").format(sample);
    case "ymd":
      // ISO 8601, deliberately separator-stable.
      return sample.toISOString().slice(0, 10);
  }
}

function previewNumber(format: NumberFormat, locale: string): string {
  // The non-auto cases use a fixed locale whose convention matches the
  // chosen separator style, so the preview is correct regardless of the
  // current UI language.
  switch (format) {
    case "auto":
      return new Intl.NumberFormat(locale).format(SAMPLE_NUMBER);
    case "comma-period":
      return new Intl.NumberFormat("en-US").format(SAMPLE_NUMBER);
    case "period-comma":
      return new Intl.NumberFormat("de-DE").format(SAMPLE_NUMBER);
    case "space-comma":
      return new Intl.NumberFormat("fr-FR").format(SAMPLE_NUMBER);
  }
}

interface LocalizationPanelProps {
  readonly timeFormat: TimeFormat;
  readonly convertToLocalTime: boolean;
  readonly dateFormat: DateFormat;
  readonly numberFormat: NumberFormat;
  readonly onTimeFormatChange: (fmt: TimeFormat) => void;
  readonly onConvertToLocalTimeChange: () => void;
  readonly onDateFormatChange: (fmt: DateFormat) => void;
  readonly onNumberFormatChange: (fmt: NumberFormat) => void;
}

const previewSubtitleStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono, monospace)",
  fontSize: "0.85em",
  opacity: 0.7,
  marginTop: 4,
};

export function LocalizationPanel({
  timeFormat,
  convertToLocalTime,
  dateFormat,
  numberFormat,
  onTimeFormatChange,
  onConvertToLocalTimeChange,
  onDateFormatChange,
  onNumberFormatChange,
}: LocalizationPanelProps) {
  const { t, i18n } = useTranslation("settings");
  const currentLanguage = (i18n.resolvedLanguage ?? "en") as SupportedLanguage;
  const locale = i18n.resolvedLanguage ?? "en";

  // Stable sample date so the previews don't tick on every render.
  const sample = useMemo(() => new Date(), []);

  // Build the Autocomplete options for the language picker. Each option
  // carries the flag SVG as a startAdornment so it shows in the dropdown
  // AND (thanks to the extended Autocomplete) next to the selected value.
  const languageOptions = useMemo<AutocompleteOption<SupportedLanguage>[]>(
    () =>
      SUPPORTED_LANGUAGES.map((lng) => {
        const Flag = LANGUAGE_FLAGS[lng];
        return {
          key: lng,
          value: lng,
          label: NATIVE_LANGUAGE_NAMES[lng],
          startAdornment: <Flag style={FLAG_STYLE} title={NATIVE_LANGUAGE_NAMES[lng]} />,
        };
      }),
    [],
  );

  const selectedLanguage =
    languageOptions.find((o) => o.value === currentLanguage) ?? null;

  const handleLanguageChange = useCallback(
    (opt: AutocompleteOption<SupportedLanguage> | null) => {
      if (opt) void i18n.changeLanguage(opt.value);
    },
    [i18n],
  );

  return (
    <>
      <h2 className={styles.panelTitle}>{t("localization.title")}</h2>

      {/* -- Language ---------------------------------------------- */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{t("language.label")}</h3>
        <p className={styles.fieldHint}>{t("language.description")}</p>
        <Autocomplete
          value={selectedLanguage}
          options={languageOptions}
          onChange={handleLanguageChange}
          label={t("language.label")}
          placeholder={t("language.searchPlaceholder")}
          noOptionsText={t("language.noMatches")}
        />
      </section>

      {/* -- Time format ------------------------------------------- */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{t("time.title")}</h3>
        <p className={styles.fieldHint}>{t("time.description")}</p>

        <label className={styles.fieldLabel}>{t("time.formatLabel")}</label>
        <div className={styles.optionGrid}>
          {TIME_FORMAT_OPTIONS.map((opt) => (
            <button
              key={opt}
              type="button"
              className={`${styles.optionCard} ${timeFormat === opt ? styles.optionCardSelected : ""}`}
              onClick={() => onTimeFormatChange(opt)}
            >
              <span className={styles.optionLabel}>{t(`time.format.${opt}`)}</span>
              <span style={previewSubtitleStyle}>{previewTime(opt, locale, sample)}</span>
            </button>
          ))}
        </div>

        <div className={styles.toggleRow} style={{ marginTop: 12 }}>
          <div className={styles.toggleInfo}>
            <label className={styles.fieldLabel}>{t("time.localLabel")}</label>
            <p className={styles.fieldHint}>{t("time.localDescription")}</p>
          </div>
          <Toggle
            checked={convertToLocalTime}
            onChange={onConvertToLocalTimeChange}
          />
        </div>
      </section>

      {/* -- Date format ------------------------------------------- */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{t("date.title")}</h3>
        <p className={styles.fieldHint}>{t("date.description")}</p>

        <div className={styles.optionGrid}>
          {DATE_FORMAT_OPTIONS.map((opt) => (
            <button
              key={opt}
              type="button"
              className={`${styles.optionCard} ${dateFormat === opt ? styles.optionCardSelected : ""}`}
              onClick={() => onDateFormatChange(opt)}
            >
              <span className={styles.optionLabel}>{t(`date.format.${opt}`)}</span>
              <span style={previewSubtitleStyle}>{previewDate(opt, locale, sample)}</span>
            </button>
          ))}
        </div>
      </section>

      {/* -- Number format ----------------------------------------- */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{t("number.title")}</h3>
        <p className={styles.fieldHint}>{t("number.description")}</p>

        <div className={styles.optionGrid}>
          {NUMBER_FORMAT_OPTIONS.map((opt) => (
            <button
              key={opt}
              type="button"
              className={`${styles.optionCard} ${numberFormat === opt ? styles.optionCardSelected : ""}`}
              onClick={() => onNumberFormatChange(opt)}
            >
              <span className={styles.optionLabel}>{t(`number.format.${opt}`)}</span>
              <span style={previewSubtitleStyle}>{previewNumber(opt, locale)}</span>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}
