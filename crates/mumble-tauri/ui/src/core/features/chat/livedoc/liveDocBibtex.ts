/**
 * liveDocBibtex - a pragmatic BibTeX <-> CSL-JSON converter.
 *
 * Hand-rolled (no dependency) parser/serialiser covering the common entry
 * types and fields.  It handles brace- and quote-delimited values, nested
 * braces, `@string`-free input, and strips the most common LaTeX accent
 * commands; it is not a full BibTeX implementation but round-trips typical
 * exported libraries.  Framework-free so it can be unit-tested.
 */

import {
  makeSourceId,
  parseAuthors,
  authorsToString,
  issuedYear,
  yearToDate,
  type CslItem,
  type CslName,
} from "./liveDocCslTypes";

/** BibTeX entry type -> CSL type. */
const TYPE_TO_CSL: Record<string, string> = {
  article: "article-journal",
  book: "book",
  booklet: "book",
  inbook: "chapter",
  incollection: "chapter",
  inproceedings: "paper-conference",
  conference: "paper-conference",
  manual: "report",
  mastersthesis: "thesis",
  phdthesis: "thesis",
  techreport: "report",
  misc: "document",
  online: "webpage",
  electronic: "webpage",
  unpublished: "manuscript",
};
const CSL_TO_TYPE: Record<string, string> = {
  "article-journal": "article",
  "article-magazine": "article",
  "article-newspaper": "article",
  book: "book",
  chapter: "incollection",
  "paper-conference": "inproceedings",
  report: "techreport",
  thesis: "phdthesis",
  webpage: "online",
  document: "misc",
  manuscript: "unpublished",
};

/** Minimal LaTeX accent / brace cleanup for display values. */
function cleanLatex(value: string): string {
  return value
    .replace(/\{\\([a-zA-Z]+)\s+([a-zA-Z])\}/g, "$2") // {\"o} style handled below; generic
    .replace(/\\["'`^~=.]\{?([a-zA-Z])\}?/g, "$1") // accented letters -> base
    .replace(/\\[a-zA-Z]+\s?/g, "") // drop remaining commands
    .replace(/[{}]/g, "")
    .replace(/~/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Read a single `{...}` or `"..."` or bare value starting at `i`. */
function readValue(src: string, start: number): { value: string; next: number } {
  let i = start;
  while (i < src.length && /\s/.test(src[i])) i++;
  if (src[i] === "{") {
    let depth = 0;
    let out = "";
    for (; i < src.length; i++) {
      const ch = src[i];
      if (ch === "{") {
        if (depth > 0) out += ch;
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
        out += ch;
      } else {
        out += ch;
      }
    }
    return { value: out, next: i };
  }
  if (src[i] === '"') {
    i++;
    let out = "";
    for (; i < src.length; i++) {
      if (src[i] === '"') {
        i++;
        break;
      }
      out += src[i];
    }
    return { value: out, next: i };
  }
  // Bare value (number or single token) up to , or }
  let out = "";
  for (; i < src.length && !",}".includes(src[i]); i++) out += src[i];
  return { value: out.trim(), next: i };
}

/** Parse a BibTeX string into CSL-JSON items. */
export function parseBibtex(input: string): CslItem[] {
  const items: CslItem[] = [];
  const text = input.replace(/\r\n?/g, "\n");
  let i = 0;
  while (i < text.length) {
    const at = text.indexOf("@", i);
    if (at < 0) break;
    const braceOpen = text.indexOf("{", at);
    if (braceOpen < 0) break;
    const type = text.slice(at + 1, braceOpen).trim().toLowerCase();
    if (type === "comment" || type === "preamble" || type === "string") {
      i = braceOpen + 1;
      continue;
    }
    // citation key up to first comma
    let j = braceOpen + 1;
    let key = "";
    for (; j < text.length && text[j] !== "," && text[j] !== "}"; j++) key += text[j];
    key = key.trim();
    const fields: Record<string, string> = {};
    j++; // skip comma
    // Parse "field = value" pairs until the matching closing brace.
    let depth = 1;
    while (j < text.length && depth > 0) {
      while (j < text.length && /[\s,]/.test(text[j])) j++;
      if (text[j] === "}") {
        depth--;
        j++;
        break;
      }
      let name = "";
      for (; j < text.length && text[j] !== "=" && text[j] !== "}"; j++) name += text[j];
      if (text[j] === "}") {
        j++;
        break;
      }
      j++; // skip '='
      const { value, next } = readValue(text, j);
      j = next;
      const fieldName = name.trim().toLowerCase();
      if (fieldName) fields[fieldName] = value;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] === ",") j++;
    }
    i = j;
    items.push(fieldsToCsl(type, key, fields));
  }
  return items;
}

function fieldsToCsl(bibType: string, key: string, f: Record<string, string>): CslItem {
  const item: CslItem = {
    id: key || makeSourceId({}),
    type: TYPE_TO_CSL[bibType] ?? "document",
  };
  if (f.title) item.title = cleanLatex(f.title);
  if (f.author) item.author = parseAuthors(cleanLatex(f.author));
  if (f.editor) item.editor = parseAuthors(cleanLatex(f.editor));
  const year = f.year || f.date?.slice(0, 4);
  if (year) item.issued = yearToDate(year);
  if (f.journal || f.journaltitle || f.booktitle) {
    item["container-title"] = cleanLatex(f.journal || f.journaltitle || f.booktitle);
  }
  if (f.series) item["collection-title"] = cleanLatex(f.series);
  if (f.publisher) item.publisher = cleanLatex(f.publisher);
  if (f.address || f.location) item["publisher-place"] = cleanLatex(f.address || f.location);
  if (f.edition) item.edition = cleanLatex(f.edition);
  if (f.volume) item.volume = f.volume;
  if (f.number || f.issue) item.issue = f.number || f.issue;
  if (f.pages) item.page = f.pages.replace(/--/g, "-");
  if (f.url) item.URL = f.url;
  if (f.doi) item.DOI = f.doi;
  if (f.isbn) item.ISBN = f.isbn;
  if (f.issn) item.ISSN = f.issn;
  if (f.abstract) item.abstract = cleanLatex(f.abstract);
  if (f.note) item.note = cleanLatex(f.note);
  return item;
}

/** Escape a value for BibTeX brace-delimited output. */
function esc(value: string): string {
  return value.replace(/[{}]/g, "");
}

function namesToBibtex(names: readonly CslName[] | undefined): string {
  if (!names) return "";
  return names
    .map((n) => (n.literal ? `{${n.literal}}` : [n.family, n.given].filter(Boolean).join(", ")))
    .join(" and ");
}

/** Serialise CSL-JSON items to a BibTeX string. */
export function toBibtex(items: ReadonlyArray<CslItem>): string {
  return items.map(itemToBibtex).join("\n\n") + "\n";
}

function itemToBibtex(item: CslItem): string {
  const bibType = CSL_TO_TYPE[item.type] ?? "misc";
  const fields: Array<[string, string]> = [];
  if (item.title) fields.push(["title", esc(item.title)]);
  if (item.author?.length) fields.push(["author", namesToBibtex(item.author)]);
  if (item.editor?.length) fields.push(["editor", namesToBibtex(item.editor)]);
  const year = issuedYear(item);
  if (year) fields.push(["year", year]);
  if (item["container-title"]) {
    const key = item.type === "book" || item.type === "chapter" ? "booktitle" : "journal";
    fields.push([key, esc(item["container-title"])]);
  }
  if (item["collection-title"]) fields.push(["series", esc(item["collection-title"])]);
  if (item.publisher) fields.push(["publisher", esc(item.publisher)]);
  if (item["publisher-place"]) fields.push(["address", esc(item["publisher-place"])]);
  if (item.edition) fields.push(["edition", esc(item.edition)]);
  if (item.volume) fields.push(["volume", item.volume]);
  if (item.issue) fields.push(["number", item.issue]);
  if (item.page) fields.push(["pages", item.page.replace(/-/g, "--")]);
  if (item.URL) fields.push(["url", item.URL]);
  if (item.DOI) fields.push(["doi", item.DOI]);
  if (item.ISBN) fields.push(["isbn", item.ISBN]);
  if (item.ISSN) fields.push(["issn", item.ISSN]);
  if (item.note) fields.push(["note", esc(item.note)]);
  const body = fields.map(([k, v]) => `  ${k} = {${v}}`).join(",\n");
  return `@${bibType}{${item.id},\n${body}\n}`;
}

/** Re-export for callers building a quick author string round-trip. */
export { authorsToString };
