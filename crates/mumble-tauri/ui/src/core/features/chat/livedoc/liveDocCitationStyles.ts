/**
 * liveDocCitationStyles - the citation-style registry.
 *
 * Maps each selectable style id to its display label and the vendored CSL
 * XML (imported as a raw string via Vite `?raw`).  The XML files live in
 * `./csl/` and were vendored from the official citation-style-language
 * repositories.  Where an exact Word edition/sort variant was unavailable
 * in the CSL project, the closest faithful equivalent is used (noted in the
 * label); Turabian author-date is, per CSL, identical to Chicago
 * author-date so it reuses that style.
 */

import apa6 from "./csl/apa-6th-edition.csl?raw";
import chicagoAuthorDate from "./csl/chicago-author-date.csl?raw";
import gb7714 from "./csl/china-national-standard-gb-t-7714-2015-numeric.csl?raw";
import gostName from "./csl/gost-r-7-0-5-2008.csl?raw";
import gostNumeric from "./csl/gost-r-7-0-5-2008-numeric.csl?raw";
import harvard from "./csl/harvard-cite-them-right.csl?raw";
import ieee from "./csl/ieee.csl?raw";
import iso690AuthorDate from "./csl/iso690-author-date-en.csl?raw";
import iso690Numeric from "./csl/iso690-numeric-en.csl?raw";
import mla from "./csl/modern-language-association.csl?raw";
import sist02 from "./csl/sist02.csl?raw";
import enUsLocale from "./csl/locales-en-US.xml?raw";

export interface CitationStyle {
  readonly id: string;
  /** Human label shown in the style dropdown. */
  readonly label: string;
  /** The raw CSL XML for citeproc. */
  readonly xml: string;
}

/** The en-US CSL locale, shared by every engine. */
export const CSL_LOCALE_EN_US = enUsLocale;

/** Ordered list mirroring Word's citation-style dropdown. */
export const CITATION_STYLES: ReadonlyArray<CitationStyle> = [
  { id: "apa", label: "APA (6th Edition)", xml: apa6 },
  { id: "chicago", label: "Chicago (Author-Date, 16th)", xml: chicagoAuthorDate },
  { id: "gb7714", label: "GB/T 7714 (Numeric)", xml: gb7714 },
  { id: "gost-name", label: "GOST R 7.0.5-2008 (Name Sort)", xml: gostName },
  { id: "gost-title", label: "GOST R 7.0.5-2008 (Title/Numeric Sort)", xml: gostNumeric },
  { id: "harvard", label: "Harvard (Cite Them Right)", xml: harvard },
  { id: "ieee", label: "IEEE", xml: ieee },
  { id: "iso690-author-date", label: "ISO 690 (First Element and Date)", xml: iso690AuthorDate },
  { id: "iso690-numeric", label: "ISO 690 (Numerical Reference)", xml: iso690Numeric },
  { id: "mla", label: "MLA (Modern Language Association)", xml: mla },
  { id: "sist02", label: "SIST02", xml: sist02 },
  { id: "turabian", label: "Turabian (Author-Date, 6th)", xml: chicagoAuthorDate },
];

export const DEFAULT_CITATION_STYLE = "apa";

const STYLE_BY_ID = new Map(CITATION_STYLES.map((s) => [s.id, s]));

export function citationStyleById(id: string): CitationStyle {
  return STYLE_BY_ID.get(id) ?? STYLE_BY_ID.get(DEFAULT_CITATION_STYLE)!;
}
