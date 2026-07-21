/**
 * useLiveDocSources - the document's *current* bibliography source list,
 * shared via Yjs so it syncs to every collaborator and persists with the
 * document (mirrors the page-setup / decoration helpers in `useLiveDoc`).
 *
 * Each source is stored as CSL-JSON in `doc.getMap("liveDocSources")`,
 * keyed by its id (last-write-wins per source).  The selected citation
 * style lives in the shared `meta` map alongside the page setup.
 */

import { useEffect, useState } from "react";
import type * as Y from "yjs";
import type { CslItem } from "./liveDocCslTypes";
import { DEFAULT_CITATION_STYLE } from "./liveDocCitationStyles";

const SOURCES_MAP = "liveDocSources";

function sourcesMap(doc: Y.Doc): Y.Map<CslItem> {
  return doc.getMap<CslItem>(SOURCES_MAP);
}

/** All current-document sources, sorted by first author then year. */
export function listLiveDocSources(doc: Y.Doc | null): CslItem[] {
  if (!doc) return [];
  const items: CslItem[] = [];
  sourcesMap(doc).forEach((value) => {
    if (value && typeof value === "object") items.push(value);
  });
  items.sort((a, b) => sourceSortKey(a).localeCompare(sourceSortKey(b)));
  return items;
}

function sourceSortKey(item: CslItem): string {
  const a = item.author?.[0];
  return (a?.family ?? a?.literal ?? item.title ?? item.id).toLowerCase();
}

/** Insert or replace a source in the current list (propagates live). */
export function setLiveDocSource(doc: Y.Doc, item: CslItem): void {
  doc.transact(() => sourcesMap(doc).set(item.id, item));
}

/** Remove a source from the current list. */
export function deleteLiveDocSource(doc: Y.Doc, id: string): void {
  doc.transact(() => sourcesMap(doc).delete(id));
}

export function getLiveDocSource(doc: Y.Doc | null, id: string): CslItem | undefined {
  if (!doc) return undefined;
  return sourcesMap(doc).get(id) ?? undefined;
}

/** Observe the current-document source list. */
export function useLiveDocSources(doc: Y.Doc | null): CslItem[] {
  const [sources, setSources] = useState<CslItem[]>(() => listLiveDocSources(doc));
  useEffect(() => {
    if (!doc) {
      setSources([]);
      return;
    }
    const map = sourcesMap(doc);
    const update = () => setSources(listLiveDocSources(doc));
    map.observe(update);
    update();
    return () => map.unobserve(update);
  }, [doc]);
  return sources;
}

// --- Citation style (shared in `meta`) ---------------------------------

/** Observe the document's selected citation style id. */
export function useLiveDocCitationStyle(doc: Y.Doc | null): string {
  const read = () => {
    const v = doc?.getMap("meta").get("citationStyle");
    return typeof v === "string" ? v : DEFAULT_CITATION_STYLE;
  };
  const [style, setStyle] = useState<string>(read);
  useEffect(() => {
    if (!doc) {
      setStyle(DEFAULT_CITATION_STYLE);
      return;
    }
    const meta = doc.getMap("meta");
    const update = () => setStyle(read());
    meta.observe(update);
    update();
    return () => meta.unobserve(update);
  }, [doc]);
  return style;
}

export function setLiveDocCitationStyle(doc: Y.Doc, styleId: string): void {
  doc.getMap("meta").set("citationStyle", styleId);
}
