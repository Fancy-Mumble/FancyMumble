/** Minimal ambient types for citeproc-js (ships no types of its own).
 *  Only the surface used by `liveDocCiteproc.ts` is declared. */
declare module "citeproc" {
  export interface CiteprocSys {
    retrieveLocale: (lang: string) => string;
    retrieveItem: (id: string) => Record<string, unknown>;
  }

  export interface CiteprocCitationItem {
    id: string;
    locator?: string;
    label?: string;
    prefix?: string;
    suffix?: string;
    "suppress-author"?: boolean;
  }

  export interface CiteprocCitation {
    citationID: string;
    citationItems: CiteprocCitationItem[];
    properties: { noteIndex: number };
  }

  export class Engine {
    constructor(sys: CiteprocSys, style: string, lang?: string, forceLang?: boolean);
    updateItems(ids: string[]): void;
    /** Reset internal state and (re)process all citations in order.
     *  Returns `[citationID, noteIndex, htmlString]` triples. */
    rebuildProcessorState(
      citations: CiteprocCitation[],
      format?: string,
    ): Array<[string, number, string]>;
    /** `[params, htmlEntries]` or `false` when nothing is cited. */
    makeBibliography(): [unknown, string[]] | false;
  }

  interface CiteprocStatic {
    Engine: typeof Engine;
  }
  const CSL: CiteprocStatic;
  export default CSL;
}

/* Vendored CSL style / locale XML, imported as raw strings via Vite. */
declare module "*.csl?raw" {
  const content: string;
  export default content;
}
