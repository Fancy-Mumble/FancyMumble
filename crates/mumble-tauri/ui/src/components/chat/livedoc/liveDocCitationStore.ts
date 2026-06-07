/**
 * liveDocCitationStore - a tiny per-editor pub/sub for formatted citation
 * output.
 *
 * Citeproc formatting is computed *once* per document change (see
 * `useLiveDocCitations`) and published here; the citation and bibliography
 * node views subscribe via `useCitationSnapshot` instead of each re-running
 * citeproc.  It lives on a dedicated Tiptap extension's storage so the data
 * travels with the editor instance and node views can read it reliably
 * (React context does not always cross Tiptap's node-view portals).
 */

import { useSyncExternalStore } from "react";
import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/react";
import type { UnresolvedCitation } from "./liveDocCitations";

export interface CitationSnapshot {
  /** Formatted in-text HTML keyed by the citation node's position string. */
  readonly textByPos: Record<string, string>;
  /** Bibliography entries (HTML), in style order. */
  readonly bibliography: string[];
  readonly unresolved: UnresolvedCitation[];
  readonly styleId: string;
  /** Bumped on every publish so subscribers re-read. */
  readonly version: number;
}

interface StoreState {
  snapshot: CitationSnapshot;
  listeners: Set<() => void>;
}

const EMPTY: CitationSnapshot = {
  textByPos: {},
  bibliography: [],
  unresolved: [],
  styleId: "apa",
  version: 0,
};

export const CITATION_STORE_NAME = "liveDocCitationStore";

export const LiveDocCitationStore = Extension.create({
  name: CITATION_STORE_NAME,
  addStorage(): StoreState {
    return { snapshot: EMPTY, listeners: new Set() };
  },
});

function store(editor: Editor): StoreState | null {
  const s = (editor.storage as unknown as Record<string, unknown>)?.[CITATION_STORE_NAME];
  return (s as StoreState | undefined) ?? null;
}

/** Publish a freshly computed snapshot and notify subscribers. */
export function publishCitationSnapshot(editor: Editor, snapshot: CitationSnapshot): void {
  const s = store(editor);
  if (!s) return;
  s.snapshot = snapshot;
  for (const cb of s.listeners) cb();
}

/** Subscribe a node view to the latest citation snapshot. */
export function useCitationSnapshot(editor: Editor): CitationSnapshot {
  return useSyncExternalStore(
    (cb) => {
      const s = store(editor);
      if (!s) return () => {};
      s.listeners.add(cb);
      return () => s.listeners.delete(cb);
    },
    () => store(editor)?.snapshot ?? EMPTY,
  );
}
