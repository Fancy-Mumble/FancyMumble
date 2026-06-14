/**
 * ISO-3166-1 alpha-2 country list for the "Register Country" server setting.
 *
 * Reuses the same country/flag source as the translation helper
 * (`country-flag-icons`, already a dependency - see
 * `translations/LanguageFlag.tsx`) rather than hard-coding a list, and pulls
 * English country names from the platform `Intl.DisplayNames`.  The stored
 * value is the lowercase 2-letter code (matching murmur's `registerlocation`).
 */

import * as Flags from "country-flag-icons/react/3x2";

export interface Country {
  /** ISO-3166-1 alpha-2 code (lowercase). */
  readonly code: string;
  /** English display name. */
  readonly name: string;
}

const REGION_NAMES: Intl.DisplayNames | null = (() => {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" });
  } catch {
    return null;
  }
})();

function regionName(cc: string): string {
  try {
    return REGION_NAMES?.of(cc) ?? cc;
  } catch {
    return cc;
  }
}

/** Every ISO-3166 alpha-2 code `country-flag-icons` ships a flag for. */
export const COUNTRY_CODES: readonly string[] = Object.keys(Flags).filter((k) =>
  /^[A-Z]{2}$/.test(k),
);

export const COUNTRIES: readonly Country[] = COUNTRY_CODES.map((cc) => ({
  code: cc.toLowerCase(),
  name: regionName(cc),
}))
  .slice()
  .sort((a, b) => a.name.localeCompare(b.name));

const BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c.name]));

/** Display name for a country code, or the code itself if unknown. */
export function countryName(code: string): string {
  return BY_CODE.get(code.toLowerCase()) ?? code;
}
