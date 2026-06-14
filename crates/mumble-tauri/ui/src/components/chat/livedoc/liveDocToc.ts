/**
 * TableOfContents - an in-document, auto-generated table of contents
 * for Live Doc.  Rendered as an atomic block leaf via a React node view
 * ([`LiveDocTocView`]) that reads the live heading list.
 *
 * Serialised to/from Markdown as `<div data-livedoc-toc></div>`; the
 * generated entries are derived from the document at render time, so the
 * persisted node carries no stale heading text.
 */

import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import LiveDocTocView from "./LiveDocTocView";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    liveDocToc: {
      /** Insert an auto-generated table of contents at the caret. */
      insertTableOfContents: () => ReturnType;
    };
  }
}

export const TableOfContents = Node.create({
  name: "tableOfContents",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,

  parseHTML() {
    return [{ tag: "div[data-livedoc-toc]" }];
  },

  renderHTML() {
    return ["div", mergeAttributes({ "data-livedoc-toc": "" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(LiveDocTocView);
  },

  addCommands() {
    return {
      insertTableOfContents:
        () =>
        ({ chain }) =>
          chain()
            .insertContent([{ type: this.name }, { type: "paragraph" }])
            .run(),
    };
  },
});

export default TableOfContents;
