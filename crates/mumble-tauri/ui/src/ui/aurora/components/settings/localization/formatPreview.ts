import type { DateFormat, NumberFormat, TimeFormat } from "@core/types";

export const TIME_FORMAT_OPTIONS: TimeFormat[] = ["auto", "12h", "24h"];
export const DATE_FORMAT_OPTIONS: DateFormat[] = ["auto", "dmy", "mdy", "ymd"];
export const NUMBER_FORMAT_OPTIONS: NumberFormat[] = ["auto", "comma-period", "period-comma", "space-comma"];

export const TIME_FORMAT_LABELS: Record<TimeFormat, string> = {
  auto: "Automatic",
  "12h": "12 hour",
  "24h": "24 hour",
};

export const DATE_FORMAT_LABELS: Record<DateFormat, string> = {
  auto: "Automatic",
  dmy: "Day / month / year",
  mdy: "Month / day / year",
  ymd: "ISO 8601",
};

export const NUMBER_FORMAT_LABELS: Record<NumberFormat, string> = {
  auto: "Automatic",
  "comma-period": "Comma / period",
  "period-comma": "Period / comma",
  "space-comma": "Space / comma",
};

const SAMPLE_NUMBER = 1234567.89;

/** How `format` renders a clock time, for the option preview. */
export function previewTime(format: TimeFormat, locale: string, sample: Date): string {
  if (format === "auto") {
    return new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(sample);
  }
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: format === "12h",
  }).format(sample);
}

/**
 * How `format` renders a date.
 *
 * The explicit formats pin a locale whose convention matches the chosen order,
 * so the preview stays truthful no matter which language the UI is in.
 */
export function previewDate(format: DateFormat, locale: string, sample: Date): string {
  switch (format) {
    case "auto":
      return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(sample);
    case "dmy":
      return new Intl.DateTimeFormat("en-GB").format(sample);
    case "mdy":
      return new Intl.DateTimeFormat("en-US").format(sample);
    case "ymd":
      return sample.toISOString().slice(0, 10);
  }
}

/** How `format` groups digits and marks the decimal, for the option preview. */
export function previewNumber(format: NumberFormat, locale: string): string {
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
