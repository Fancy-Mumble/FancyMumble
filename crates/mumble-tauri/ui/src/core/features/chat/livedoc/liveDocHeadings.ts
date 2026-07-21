/**
 * liveDocHeadings - pure heading extraction for the Live Doc outline
 * pane and the in-document "Table of Contents" node.
 *
 * The extraction logic walks a ProseMirror document and returns a flat,
 * document-ordered list of headings (H1-H6).  Nesting for the outline is
 * derived from the `level` field, so a flat list is enough and keeps the
 * core logic trivially unit-testable (no React, no editor view).
 */

import { useEffect, useState } from "react";
import type { Node as PmNode } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";

export interface HeadingItem {
  /** Heading level, 1-6. */
  readonly level: number;
  /** Trimmed plain-text content of the heading. */
  readonly text: string;
  /** ProseMirror position of the heading node (node start). */
  readonly pos: number;
  /** Zero-based ordinal among all headings in document order. */
  readonly index: number;
  /** Stable-ish slug derived from the text + ordinal, used as a key. */
  readonly id: string;
}

const MIN_LEVEL = 1;
const MAX_LEVEL = 6;

/** Build a URL-safe slug from heading text, disambiguated by its index. */
export function slugifyHeading(text: string, index: number): string {
  const base = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
  return base ? `${base}-${index}` : `heading-${index}`;
}

function clampLevel(raw: unknown): number {
  const level = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(level)) return MIN_LEVEL;
  return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.trunc(level)));
}

/**
 * Walk `doc` and collect every heading node in document order.
 *
 * Pure: depends only on the ProseMirror node tree, so it can be unit
 * tested against a real `Editor` document built in jsdom.
 */
export function extractHeadings(doc: PmNode): HeadingItem[] {
  const items: HeadingItem[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "heading") return undefined;
    const level = clampLevel(node.attrs.level);
    const text = node.textContent.trim();
    const index = items.length;
    items.push({ level, text, pos, index, id: slugifyHeading(text, index) });
    // Headings cannot contain other headings, so there's no need to
    // descend further into this node.
    return false;
  });
  return items;
}

/** Smallest heading level present, defaulting to 1 for an empty list. */
export function minHeadingLevel(items: readonly HeadingItem[]): number {
  let min = MAX_LEVEL;
  for (const item of items) {
    if (item.level < min) min = item.level;
  }
  return items.length ? min : MIN_LEVEL;
}

/** Compact signature used to skip redundant state updates. */
function headingsSignature(items: readonly HeadingItem[]): string {
  return items.map((h) => `${h.pos}:${h.level}:${h.text}`).join("\u0001");
}

/** Scroll the editor so the node at `pos` is brought into view. */
export function scrollToPos(editor: Editor, pos: number): void {
  const dom = editor.view.nodeDOM(pos);
  if (dom instanceof HTMLElement && typeof dom.scrollIntoView === "function") {
    dom.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

/** Scroll the editor so the heading at `pos` is brought into view. */
export function scrollToHeading(editor: Editor, pos: number): void {
  scrollToPos(editor, pos);
}

export interface UseLiveDocHeadings {
  readonly headings: HeadingItem[];
  /** Force an immediate re-scan of the document. */
  readonly refresh: () => void;
}

/**
 * Subscribe to a live editor and return its current headings.
 *
 * Recomputes on document changes (`update`) and on editor `create`.
 * Emits a new array only when the heading set actually changes, so the
 * consuming component does not re-render on unrelated edits.
 */
export function useLiveDocHeadings(editor: Editor | null): UseLiveDocHeadings {
  const [headings, setHeadings] = useState<HeadingItem[]>([]);

  useEffect(() => {
    if (!editor) {
      setHeadings([]);
      return undefined;
    }
    let lastSig: string | null = null;
    const sync = () => {
      const next = extractHeadings(editor.state.doc);
      const sig = headingsSignature(next);
      if (sig === lastSig) return;
      lastSig = sig;
      setHeadings(next);
    };
    sync();
    editor.on("update", sync);
    editor.on("create", sync);
    return () => {
      editor.off("update", sync);
      editor.off("create", sync);
    };
  }, [editor]);

  const refresh = () => {
    if (editor) setHeadings(extractHeadings(editor.state.doc));
  };

  return { headings, refresh };
}
