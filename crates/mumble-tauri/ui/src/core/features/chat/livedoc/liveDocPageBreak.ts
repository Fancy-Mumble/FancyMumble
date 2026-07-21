/**
 * PageBreak - a manual, document-level page break for Live Doc.
 *
 * Rendered as an atomic block leaf so it sits between paragraphs like a
 * horizontal rule.  On screen it shows a dashed "Page break" divider; in
 * the print / PDF export it forces a real page break via
 * `break-after: page` (see `liveDocPdf.ts` and the editor stylesheet).
 *
 * Serialised to/from Markdown as `<div data-page-break></div>` (raw HTML
 * passes through the Markdown round-trip unchanged), so breaks survive an
 * export/import cycle.
 */

import { Node, mergeAttributes } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    liveDocPageBreak: {
      /** Insert a manual page break at the current selection. */
      setPageBreak: () => ReturnType;
    };
    liveDocSectionBreak: {
      /** Insert a "next page" section break at the current selection. */
      setSectionBreak: () => ReturnType;
    };
  }
}

export const PageBreak = Node.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,

  parseHTML() {
    return [{ tag: "div[data-page-break]" }];
  },

  renderHTML() {
    return [
      "div",
      mergeAttributes({ "data-page-break": "", class: "livedoc-page-break" }),
    ];
  },

  addCommands() {
    return {
      setPageBreak:
        () =>
        ({ chain }) =>
          // Insert the break and a trailing paragraph so the caret has a
          // place to land on the "next page".
          chain()
            .insertContent([{ type: this.name }, { type: "paragraph" }])
            .run(),
    };
  },
});

/**
 * SectionBreak - a "next page" section boundary.
 *
 * Behaves like a page break in this (single-surface) editor and in the
 * print/PDF export, but is a distinct node so future per-section page
 * setup (orientation, margins, columns) has a boundary to attach to.
 */
export const SectionBreak = Node.create({
  name: "sectionBreak",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,

  parseHTML() {
    return [{ tag: "div[data-section-break]" }];
  },

  renderHTML() {
    return [
      "div",
      mergeAttributes({ "data-section-break": "", class: "livedoc-section-break" }),
    ];
  },

  addCommands() {
    return {
      setSectionBreak:
        () =>
        ({ chain }) =>
          chain()
            .insertContent([{ type: this.name }, { type: "paragraph" }])
            .run(),
    };
  },
});

export default PageBreak;
