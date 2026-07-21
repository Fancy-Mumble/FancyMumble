/**
 * Shared fuzzy matching used by search boxes across the app (the public
 * server list, the file-server admin dashboard, ...).
 *
 * Subsequence match: every character of `query` must appear in `text`, in
 * order, but not necessarily contiguously.  Matching is case-insensitive;
 * pass an already-lowercased `query` for the cheapest path.
 */

/** True when every character of `query` appears in `text` in order. */
export function fuzzyMatch(query: string, text: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const lower = text.toLowerCase();
  let qi = 0;
  for (let i = 0; i < lower.length && qi < q.length; i++) {
    if (lower[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

/** True when `query` fuzzy-matches any of the supplied fields. */
export function fuzzyMatchAny(query: string, fields: ReadonlyArray<string | null | undefined>): boolean {
  if (!query) return true;
  return fields.some((f) => f != null && fuzzyMatch(query, f));
}
