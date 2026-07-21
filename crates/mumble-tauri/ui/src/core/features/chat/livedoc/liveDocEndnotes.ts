/**
 * liveDocEndnotes - pure logic for Live Doc endnotes (roadmap item 3).
 *
 * An endnote is an inline superscript marker placed in the body text; its
 * note text is stored on the marker node and surfaced, auto-numbered, in
 * a generated "Endnotes" section at the end of the document.  Numbers are
 * derived live from document order, so inserting or deleting a marker
 * renumbers the rest automatically and nothing stale is persisted.
 *
 * This module is free of React and i18n so it can be unit-tested against
 * a real ProseMirror document built in jsdom.
 */

import type { Node as PmNode } from "@tiptap/pm/model";

/** The inline marker node name. */
export const ENDNOTE_REF_NODE = "endnoteRef";
/** The generated endnotes-section node name. */
export const ENDNOTES_SECTION_NODE = "endnotesSection";

export interface EndnoteEntry {
  /** Stable id shared by the marker and its rendered note. */
  readonly noteId: string;
  /** 1-based sequence number in document order. */
  readonly number: number;
  /** The note body text (stored on the marker node). */
  readonly text: string;
  /** ProseMirror position of the marker node, used to scroll to it. */
  readonly pos: number;
}

/**
 * Walk `doc` and collect every endnote marker in document order,
 * numbering them 1..N.  Markers without a `noteId` are skipped.
 */
export function extractEndnotes(doc: PmNode): EndnoteEntry[] {
  const entries: EndnoteEntry[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== ENDNOTE_REF_NODE) return undefined;
    const noteId = String(node.attrs.noteId ?? "");
    if (!noteId) return undefined;
    entries.push({
      noteId,
      number: entries.length + 1,
      text: String(node.attrs.text ?? ""),
      pos,
    });
    return undefined;
  });
  return entries;
}

/** Look up an endnote's 1-based number by its id. */
export function endnoteNumberFor(
  noteId: string,
  entries: readonly EndnoteEntry[],
): number | undefined {
  return entries.find((e) => e.noteId === noteId)?.number;
}

/** Find an endnote entry by id. */
export function resolveEndnote(
  noteId: string,
  entries: readonly EndnoteEntry[],
): EndnoteEntry | undefined {
  return entries.find((e) => e.noteId === noteId);
}

/** Position of the generated endnotes section, if present. */
export function findEndnotesSectionPos(doc: PmNode): number | undefined {
  let found: number | undefined;
  doc.descendants((node, pos) => {
    if (found !== undefined) return false;
    if (node.type.name === ENDNOTES_SECTION_NODE) {
      found = pos;
      return false;
    }
    return undefined;
  });
  return found;
}

/** True when the document already contains an endnotes section. */
export function hasEndnotesSection(doc: PmNode): boolean {
  return findEndnotesSectionPos(doc) !== undefined;
}

/** Compact signature used to skip redundant React state updates. */
export function endnotesSignature(entries: readonly EndnoteEntry[]): string {
  return entries
    .map((e) => `${e.pos}:${e.noteId}:${e.number}:${e.text}`)
    .join("\u0001");
}
