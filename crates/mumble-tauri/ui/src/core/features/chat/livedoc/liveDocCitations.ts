/**
 * liveDocCitations - pure logic for in-text citations.
 *
 * A `citation` node either references one or more sources (by CSL id) or is
 * an unset *placeholder* (a named slot to fill in later, like Word's
 * placeholder sources).  This module walks the document in reading order
 * (which drives numeric styles) and is free of React / citeproc so it can
 * be unit-tested.
 */

import type { Node as PmNode } from "@tiptap/pm/model";

export const CITATION_NODE = "citation";
export const BIBLIOGRAPHY_NODE = "bibliography";

/** One source reference inside a citation cluster. */
export interface CitationItemRef {
  readonly id: string;
  readonly locator?: string;
  readonly prefix?: string;
  readonly suffix?: string;
}

export interface CitationDescriptor {
  /** ProseMirror position of the citation node. */
  readonly pos: number;
  /** Referenced sources (empty for an unset placeholder). */
  readonly items: CitationItemRef[];
  /** Placeholder tag when this citation has no real source yet. */
  readonly placeholder: string;
}

/** Parse the `items` attribute (stored as a JSON string) defensively. */
export function parseCitationItems(raw: unknown): CitationItemRef[] {
  if (Array.isArray(raw)) return raw as CitationItemRef[];
  if (typeof raw !== "string" || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CitationItemRef[]) : [];
  } catch {
    return [];
  }
}

/** Walk `doc` and collect every citation node in document order. */
export function extractCitations(doc: PmNode): CitationDescriptor[] {
  const out: CitationDescriptor[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== CITATION_NODE) return undefined;
    out.push({
      pos,
      items: parseCitationItems(node.attrs.items),
      placeholder: String(node.attrs.placeholder ?? ""),
    });
    return undefined;
  });
  return out;
}

/** A citation that cannot be rendered: an unset placeholder, or one that
 *  references a source missing from the current list. */
export interface UnresolvedCitation {
  readonly pos: number;
  readonly placeholder: string;
  /** Source ids referenced but not present in the current list. */
  readonly missingIds: string[];
}

/** Identify citations needing attention given the available source ids. */
export function findUnresolved(
  citations: readonly CitationDescriptor[],
  availableIds: ReadonlySet<string>,
): UnresolvedCitation[] {
  const out: UnresolvedCitation[] = [];
  for (const c of citations) {
    if (c.placeholder && c.items.length === 0) {
      out.push({ pos: c.pos, placeholder: c.placeholder, missingIds: [] });
      continue;
    }
    const missing = c.items.map((i) => i.id).filter((id) => !availableIds.has(id));
    if (missing.length > 0) {
      out.push({ pos: c.pos, placeholder: c.placeholder, missingIds: missing });
    }
  }
  return out;
}

/** Compact signature used to skip redundant recomputation. */
export function citationsSignature(citations: readonly CitationDescriptor[]): string {
  return citations
    .map((c) => `${c.pos}:${c.placeholder}:${c.items.map((i) => `${i.id}|${i.locator ?? ""}`).join(",")}`)
    .join("");
}
