/**
 * The fence around a body's legacy-only part, and the cut that removes it.
 *
 * Apart from `legacyFallback.ts` so the store can ask what a body looks like
 * to a Fancy client without importing the code that builds the copy.
 */
export const LEGACY_FALLBACK_OPEN = "<!-- FANCY_LEGACY -->";
export const LEGACY_FALLBACK_CLOSE = "<!-- /FANCY_LEGACY -->";

const LEGACY_FALLBACK_RE = /<!-- FANCY_LEGACY -->[\s\S]*?<!-- \/FANCY_LEGACY -->/g;

/**
 * The same cut the backend makes, for a body that has not been through it yet.
 *
 * Only beside a file marker, as there: a fence anywhere else is text somebody
 * wrapped to hide it from Fancy clients, and it stays.
 */
export function stripLegacyFallback(body: string): string {
  if (!body.includes(LEGACY_FALLBACK_OPEN) || !body.includes("<!-- FANCY_FILE:")) return body;
  return body.replace(LEGACY_FALLBACK_RE, "").trimEnd();
}
