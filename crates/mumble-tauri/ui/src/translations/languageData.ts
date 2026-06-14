/**
 * Thin wrapper around `language-flag-colors` providing the subset of
 * data the translation helper actually needs.  We intentionally avoid
 * leaking the package's whole API into the rest of the codebase.
 *
 * The default export from `language-flag-colors` is an array of language
 * objects with `ids.locale` (e.g. `nl-NL`), native name, English name,
 * country, emoji flag and a colour palette.  Variants such as `zh-Hans`
 * and `zh-Hant` appear as distinct entries with different country codes,
 * which is exactly what we want for the "pick a language" picker.
 */

import languages, { type Language } from "language-flag-colors";

export interface LanguageEntry {
  /** Display name in English, e.g. "Chinese (Simplified)". */
  readonly englishName: string;
  /** Native name, e.g. "中文". */
  readonly nativeName: string;
  /** Locale code such as `zh-CN`, `pt-BR`, `nl`.  Preferred over ISO_639_1. */
  readonly code: string;
  /** Two-letter language code, e.g. `zh`. */
  readonly iso6391: string;
  /** ISO-3166 alpha-2 country code, uppercased, e.g. `CN`.  May be null. */
  readonly countryCode: string | null;
  /** Flag emoji (cross-platform). */
  readonly emoji: string;
  /** Primary flag colour hex, used as a fallback when no flag SVG renders. */
  readonly primaryColor: string;
}

const raw = languages as Language[];

export const ALL_LANGUAGES: LanguageEntry[] = raw
  .map((l): LanguageEntry | null => {
    const code = l.ids?.locale ?? l.ids?.ISO_639_1;
    if (!code) return null;
    return {
      englishName: l.name,
      nativeName: l.nativeName,
      code,
      iso6391: l.ids?.ISO_639_1 ?? code.split("-")[0]!,
      countryCode: l.countryCode ? l.countryCode.toUpperCase() : null,
      emoji: l.flag?.emoji ?? "🌐",
      primaryColor: l.flag?.primaryColor?.hex ?? "#777",
    };
  })
  .filter((x): x is LanguageEntry => x !== null)
  .sort((a, b) => a.englishName.localeCompare(b.englishName));

const BY_CODE = new Map(ALL_LANGUAGES.map((l) => [l.code.toLowerCase(), l]));
const BY_ISO = new Map<string, LanguageEntry>();
for (const l of ALL_LANGUAGES) {
  if (!BY_ISO.has(l.iso6391)) BY_ISO.set(l.iso6391, l);
}

/** Look up the best language entry for a code (locale or ISO-639-1). */
export function lookupLanguage(code: string): LanguageEntry | null {
  if (!code) return null;
  const lc = code.toLowerCase();
  return BY_CODE.get(lc) ?? BY_ISO.get(lc.split("-")[0]!) ?? null;
}
