/**
 * liveDocCiteproc - thin wrapper around citeproc-js.
 *
 * Builds (and caches) a CSL engine per style id and formats a whole
 * document's citations + bibliography in one pass.  Engines are cached
 * because parsing a CSL style (Chicago is ~160 KB) is the expensive part;
 * the cheap per-render work is swapping the item map and calling
 * `rebuildProcessorState`, which resets engine state so each render is
 * computed from scratch (no stale numbering / ibid carry-over).
 *
 * Pure + framework-free so the formatting is identical on every peer.
 */

import CSL, { type CiteprocCitation } from "citeproc";
import { citationStyleById, CSL_LOCALE_EN_US } from "./liveDocCitationStyles";
import type { CslItem } from "./liveDocCslTypes";

/** One in-text citation cluster (a `citation` node may cite several items). */
export interface CitationCluster {
  /** Stable id for citeproc (we use the node's document position). */
  readonly id: string;
  readonly items: ReadonlyArray<{
    readonly id: string;
    readonly locator?: string;
    readonly prefix?: string;
    readonly suffix?: string;
  }>;
}

export interface FormattedDocument {
  /** Formatted in-text string keyed by cluster id. */
  readonly textById: Map<string, string>;
  /** Bibliography entries as HTML strings, in style order. */
  readonly bibliography: string[];
}

interface CachedEngine {
  engine: InstanceType<typeof CSL.Engine>;
  items: Map<string, CslItem>;
}

const engineCache = new Map<string, CachedEngine>();

function getEngine(styleId: string): CachedEngine {
  const cached = engineCache.get(styleId);
  if (cached) return cached;
  const items = new Map<string, CslItem>();
  const sys = {
    retrieveLocale: () => CSL_LOCALE_EN_US,
    retrieveItem: (id: string) => (items.get(id) ?? { id, type: "document" }) as Record<string, unknown>,
  };
  const engine = new CSL.Engine(sys, citationStyleById(styleId).xml, "en-US");
  const entry: CachedEngine = { engine, items };
  engineCache.set(styleId, entry);
  return entry;
}

/**
 * Format every citation cluster + the bibliography for one document.
 *
 * `sources` is the current item pool; `clusters` are the document's
 * citations in reading order (their order drives numeric styles).
 */
export function formatDocument(
  styleId: string,
  sources: ReadonlyMap<string, CslItem>,
  clusters: ReadonlyArray<CitationCluster>,
): FormattedDocument {
  const textById = new Map<string, string>();
  let bibliography: string[] = [];

  try {
    const { engine, items } = getEngine(styleId);
    items.clear();
    for (const [id, item] of sources) items.set(id, item);

    // Only feed items that actually exist as sources; unknown ids (unset
    // placeholders / deleted sources) are handled by the caller.
    const citedIds = new Set<string>();
    const citeprocCitations: CiteprocCitation[] = [];
    clusters.forEach((cluster) => {
      const citationItems = cluster.items
        .filter((it) => items.has(it.id))
        .map((it) => ({
          id: it.id,
          ...(it.locator ? { locator: it.locator } : {}),
          ...(it.prefix ? { prefix: it.prefix } : {}),
          ...(it.suffix ? { suffix: it.suffix } : {}),
        }));
      for (const it of citationItems) citedIds.add(it.id);
      citeprocCitations.push({
        citationID: cluster.id,
        citationItems,
        properties: { noteIndex: 0 },
      });
    });

    engine.updateItems([...citedIds]);

    if (citeprocCitations.length > 0) {
      const rebuilt = engine.rebuildProcessorState(citeprocCitations, "html");
      for (const [citationID, , htmlString] of rebuilt) {
        textById.set(citationID, htmlString);
      }
    }

    const bib = engine.makeBibliography();
    if (bib) bibliography = bib[1];
  } catch (e) {
    console.warn("[liveDocCiteproc] formatting failed:", e);
  }

  return { textById, bibliography };
}

/** Drop cached engines (e.g. on hot-reload).  Not required at runtime. */
export function resetCiteprocCache(): void {
  engineCache.clear();
}
