/**
 * Persisted UI preferences for the Audit Log tab.
 *
 * Small, dependency-free wrappers over `localStorage` so every audit setting
 * (which sub-page you were on, whether the quick-filter rail is open, endless
 * scrolling vs. pagination) survives a reload from one place instead of each
 * component hand-rolling its own try/catch.
 *
 * Storage is best-effort: private mode or a disabled store falls back to the
 * caller's default and silently drops writes.
 */

const PREFIX = "fancy.audit.";

/** Which sub-page the tab opens on. */
export const PREF_PAGE = "page";
/** Whether the quick-filter rail is expanded. */
export const PREF_RAIL_OPEN = "ezRailOpen";
/** Endless scrolling (true) vs. pagination (false) for the results table. */
export const PREF_ENDLESS = "endlessScroll";

export function readBoolPref(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : raw === "1";
  } catch {
    return fallback;
  }
}

export function writeBoolPref(key: string, value: boolean): void {
  try {
    localStorage.setItem(PREFIX + key, value ? "1" : "0");
  } catch {
    /* storage unavailable - keep the in-memory value */
  }
}

/**
 * Read a string preference, constrained to `allowed` so a stale or hand-edited
 * value can never select a sub-page that no longer exists.
 */
export function readEnumPref<T extends string>(
  key: string,
  fallback: T,
  allowed: readonly T[],
): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw != null && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeEnumPref(key: string, value: string): void {
  try {
    localStorage.setItem(PREFIX + key, value);
  } catch {
    /* storage unavailable - keep the in-memory value */
  }
}
