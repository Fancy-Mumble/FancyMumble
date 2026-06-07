/**
 * useLiveDocCitations - computes the document's formatted citations +
 * bibliography once per change and publishes them to the citation store.
 *
 * Run once (in `LiveDocEditor`); the citation / bibliography node views
 * read the result via `useCitationSnapshot`.  Recomputation is gated by a
 * signature over the citations, the source pool and the selected style, so
 * unrelated edits don't re-run citeproc and we avoid render loops.
 */

import { useEffect, useRef } from "react";
import type { Editor } from "@tiptap/react";
import type * as Y from "yjs";
import {
  extractCitations,
  citationsSignature,
  findUnresolved,
  type CitationDescriptor,
} from "./liveDocCitations";
import { formatDocument, type CitationCluster } from "./liveDocCiteproc";
import { useLiveDocSources, useLiveDocCitationStyle } from "./useLiveDocSources";
import { publishCitationSnapshot } from "./liveDocCitationStore";
import type { CslItem } from "./liveDocCslTypes";

function buildClusters(citations: readonly CitationDescriptor[]): CitationCluster[] {
  return citations
    .filter((c) => c.items.length > 0)
    .map((c) => ({
      id: String(c.pos),
      items: c.items.map((i) => ({
        id: i.id,
        ...(i.locator ? { locator: i.locator } : {}),
        ...(i.prefix ? { prefix: i.prefix } : {}),
        ...(i.suffix ? { suffix: i.suffix } : {}),
      })),
    }));
}

function sourcesSignature(sources: readonly CslItem[]): string {
  return sources.map((s) => `${s.id}:${JSON.stringify(s)}`).join("");
}

export function useLiveDocCitations(editor: Editor | null, doc: Y.Doc | null): void {
  const sources = useLiveDocSources(doc);
  const styleId = useLiveDocCitationStyle(doc);
  const lastSig = useRef<string>("");

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;

    const sourceMap = new Map<string, CslItem>(sources.map((s) => [s.id, s]));
    const availableIds = new Set(sourceMap.keys());
    const srcSig = sourcesSignature(sources);

    const recompute = () => {
      if (editor.isDestroyed) return;
      const citations = extractCitations(editor.state.doc);
      const sig = `${styleId}${srcSig}${citationsSignature(citations)}`;
      if (sig === lastSig.current) return;
      lastSig.current = sig;

      const clusters = buildClusters(citations);
      const { textById, bibliography } = formatDocument(styleId, sourceMap, clusters);
      const textByPos: Record<string, string> = {};
      textById.forEach((value, key) => {
        textByPos[key] = value;
      });
      publishCitationSnapshot(editor, {
        textByPos,
        bibliography,
        unresolved: findUnresolved(citations, availableIds),
        styleId,
        version: Date.now(),
      });
    };

    recompute();
    editor.on("update", recompute);
    editor.on("create", recompute);
    return () => {
      editor.off("update", recompute);
      editor.off("create", recompute);
    };
  }, [editor, doc, sources, styleId]);
}
