/**
 * liveDocCslTypes - the CSL-JSON shape used as the lingua franca for Live
 * Doc sources, plus small helpers shared by the BibTeX converter, the
 * source editor and the citeproc engine.
 *
 * Sources are stored as CSL-JSON (the format citeproc consumes and that
 * BibTeX maps onto cleanly).  We model only the common subset of fields;
 * unknown fields are preserved verbatim so nothing is lost on round-trip.
 */

export interface CslName {
  readonly family?: string;
  readonly given?: string;
  /** Institutional / non-personal name (rendered as-is). */
  readonly literal?: string;
}

export interface CslDate {
  /** `[[year]]` or `[[year, month]]` or `[[year, month, day]]`. */
  readonly "date-parts"?: ReadonlyArray<ReadonlyArray<number>>;
  readonly raw?: string;
}

/** A CSL-JSON bibliographic item.  Extra/unknown keys are allowed. */
export interface CslItem {
  id: string;
  type: string;
  title?: string;
  author?: CslName[];
  editor?: CslName[];
  issued?: CslDate;
  "container-title"?: string;
  "collection-title"?: string;
  publisher?: string;
  "publisher-place"?: string;
  edition?: string;
  volume?: string;
  issue?: string;
  page?: string;
  number?: string;
  URL?: string;
  DOI?: string;
  ISBN?: string;
  ISSN?: string;
  abstract?: string;
  note?: string;
  [key: string]: unknown;
}

/** CSL item types exposed in the source editor (Word-ish source kinds). */
export const CSL_TYPES: ReadonlyArray<{ readonly value: string; readonly labelKey: string }> = [
  { value: "book", labelKey: "book" },
  { value: "chapter", labelKey: "chapter" },
  { value: "article-journal", labelKey: "articleJournal" },
  { value: "paper-conference", labelKey: "paperConference" },
  { value: "webpage", labelKey: "webpage" },
  { value: "report", labelKey: "report" },
  { value: "thesis", labelKey: "thesis" },
  { value: "article-magazine", labelKey: "articleMagazine" },
  { value: "article-newspaper", labelKey: "articleNewspaper" },
];

/** Generate a stable, BibTeX-ish citation key, e.g. `smith2020`. */
export function makeSourceId(item: Partial<CslItem>): string {
  const first = item.author?.[0];
  const namePart = (first?.family ?? first?.literal ?? "source")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 20);
  const year = item.issued?.["date-parts"]?.[0]?.[0];
  const base = `${namePart || "source"}${year ?? ""}`;
  // Add a short random suffix so two sources by the same author/year differ.
  return `${base}-${Math.random().toString(36).slice(2, 6)}`;
}

/** First author's display surname (family or literal), or empty string. */
export function primaryAuthor(item: CslItem): string {
  const a = item.author?.[0] ?? item.editor?.[0];
  if (!a) return "";
  if (a.literal) return a.literal;
  return [a.family, a.given].filter(Boolean).join(", ");
}

/** Publication year as a string, or empty. */
export function issuedYear(item: CslItem): string {
  const y = item.issued?.["date-parts"]?.[0]?.[0];
  return y ? String(y) : "";
}

/** One-line label for menus / source lists: "Smith, J. (2020) — Title". */
export function sourceLabel(item: CslItem): string {
  const who = primaryAuthor(item) || (item.title ?? item.id);
  const year = issuedYear(item);
  const title = item.title ? ` — ${item.title}` : "";
  return year ? `${who} (${year})${title}` : `${who}${title}`;
}

/** Parse a free-text author list ("Smith, John; Doe, Jane" or
 *  "John Smith and Jane Doe") into CSL names. */
export function parseAuthors(input: string): CslName[] {
  const trimmed = input.trim();
  if (!trimmed) return [];
  const parts = trimmed.includes(";")
    ? trimmed.split(";")
    : trimmed.split(/\s+and\s+/i);
  const names: CslName[] = [];
  for (const raw of parts) {
    const p = raw.trim();
    if (!p) continue;
    if (p.includes(",")) {
      const [family, given] = p.split(",", 2).map((s) => s.trim());
      names.push({ family, given });
    } else {
      const tokens = p.split(/\s+/);
      if (tokens.length === 1) {
        names.push({ family: tokens[0] });
      } else {
        names.push({ family: tokens[tokens.length - 1], given: tokens.slice(0, -1).join(" ") });
      }
    }
  }
  return names;
}

/** Render CSL names back to the editable "Family, Given; …" string. */
export function authorsToString(names: readonly CslName[] | undefined): string {
  if (!names) return "";
  return names
    .map((n) => (n.literal ? n.literal : [n.family, n.given].filter(Boolean).join(", ")))
    .join("; ");
}

/** Build a CslDate from a year string (the editor only edits the year). */
export function yearToDate(year: string): CslDate | undefined {
  const n = parseInt(year, 10);
  return Number.isFinite(n) ? { "date-parts": [[n]] } : undefined;
}
