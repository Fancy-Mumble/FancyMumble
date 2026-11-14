/**
 * HTML-escaping helper.
 *
 * Consolidates the several near-copies that previously lived in `mentions`,
 * `liveDocMarkdown` and `liveDocPdf`.  Uses the most defensive set of the five
 * HTML-significant characters (`& < > " '`) so the result is safe to embed in
 * HTML text *and* in single- or double-quoted attribute values - escaping a
 * superset is always safe in those contexts.
 */

const HTML_ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escape `& < > " '` for safe insertion into HTML text or attribute values. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPE[c] ?? c);
}
