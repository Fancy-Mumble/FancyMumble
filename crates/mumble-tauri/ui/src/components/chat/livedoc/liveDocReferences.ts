/**
 * liveDocReferences - pure logic for Live Doc bookmarks, captions and
 * cross-references (roadmap item 2).
 *
 * A "reference target" is anything a cross-reference can point at:
 *   - a heading (referenced by a text-derived slug),
 *   - a bookmark (an explicit named anchor with a stable id),
 *   - a caption (figure / table / equation, auto-numbered per kind).
 *
 * The extraction walks a ProseMirror document and returns a flat,
 * document-ordered list of targets with captions already numbered.  It
 * is deliberately free of React and i18n so it can be unit-tested
 * against a real `Editor` document built in jsdom.
 */

import type { Node as PmNode } from "@tiptap/pm/model";

/** Caption categories that carry their own auto-numbering sequence. */
export const CAPTION_KINDS = ["figure", "table", "equation"] as const;
export type CaptionKind = (typeof CAPTION_KINDS)[number];

export type RefKind = "heading" | "bookmark" | CaptionKind;

export interface RefTarget {
  /** Stable target id: `h:<slug>`, `bm:<id>` or `cap:<id>`. */
  readonly id: string;
  readonly kind: RefKind;
  /** Human-readable text (heading text / bookmark label / caption text). */
  readonly label: string;
  /** ProseMirror position of the target node, used to scroll to it. */
  readonly pos: number;
  /** 1-based sequence number within its kind; captions only. */
  readonly number?: number;
}

const HEADING_PREFIX = "h:";
const BOOKMARK_PREFIX = "bm:";
const CAPTION_PREFIX = "cap:";

/** Build a URL-safe slug from arbitrary text, with a stable fallback. */
export function refSlug(text: string): string {
  const base = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
  return base || "section";
}

export function headingTargetId(text: string): string {
  return `${HEADING_PREFIX}${refSlug(text)}`;
}

export function bookmarkTargetId(bookmarkId: string): string {
  return `${BOOKMARK_PREFIX}${bookmarkId}`;
}

export function captionTargetId(captionId: string): string {
  return `${CAPTION_PREFIX}${captionId}`;
}

function isCaptionKind(value: unknown): value is CaptionKind {
  return (CAPTION_KINDS as readonly string[]).includes(value as string);
}

/**
 * Walk `doc` and collect every reference target in document order.
 *
 * Captions are numbered per kind (Figure 1, Figure 2, Table 1, ...) in
 * the order they appear in the document.
 */
export function extractReferenceTargets(doc: PmNode): RefTarget[] {
  const targets: RefTarget[] = [];
  const captionCounters: Record<CaptionKind, number> = {
    figure: 0,
    table: 0,
    equation: 0,
  };

  doc.descendants((node, pos) => {
    const name = node.type.name;

    if (name === "heading") {
      const text = node.textContent.trim();
      targets.push({
        id: headingTargetId(text),
        kind: "heading",
        label: text,
        pos,
      });
      return false;
    }

    if (name === "bookmark") {
      const bookmarkId = String(node.attrs.bookmarkId ?? "");
      if (!bookmarkId) return undefined;
      targets.push({
        id: bookmarkTargetId(bookmarkId),
        kind: "bookmark",
        label: String(node.attrs.label ?? "").trim(),
        pos,
      });
      return undefined;
    }

    if (name === "caption") {
      const kind = isCaptionKind(node.attrs.kind) ? node.attrs.kind : "figure";
      const captionId = String(node.attrs.captionId ?? "");
      captionCounters[kind] += 1;
      if (captionId) {
        targets.push({
          id: captionTargetId(captionId),
          kind,
          label: node.textContent.trim(),
          pos,
          number: captionCounters[kind],
        });
      }
      // Captions hold editable inline text; do not descend further for
      // target purposes (their text is captured via textContent).
      return false;
    }

    return undefined;
  });

  return targets;
}

/** Find a target by id; first match wins (handles duplicate slugs). */
export function resolveTarget(
  id: string,
  targets: readonly RefTarget[],
): RefTarget | undefined {
  return targets.find((t) => t.id === id);
}

/** True for the caption kinds that carry an auto-number. */
export function isNumberedTarget(target: RefTarget): boolean {
  return isCaptionKind(target.kind);
}

/** Compact signature used to skip redundant React state updates. */
export function referenceTargetsSignature(targets: readonly RefTarget[]): string {
  return targets
    .map((t) => `${t.pos}:${t.id}:${t.number ?? ""}:${t.label}`)
    .join("\u0001");
}
