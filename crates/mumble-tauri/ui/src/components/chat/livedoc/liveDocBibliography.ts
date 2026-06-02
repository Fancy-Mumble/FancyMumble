/**
 * Bibliography - an auto-generated reference list block.  Like the
 * endnotes section it is an atomic block whose React view
 * ([`LiveDocBibliographyView`]) renders the live, style-formatted entries
 * from the shared citation snapshot.  The placeholder node carries no
 * stale text, so only the cited sources + current style decide its output.
 *
 * Serialised to/from Markdown as `<div data-livedoc-bibliography></div>`.
 */

import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import LiveDocBibliographyView from "./LiveDocBibliographyView";
import { BIBLIOGRAPHY_NODE } from "./liveDocCitations";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    liveDocBibliography: {
      /** Insert the generated bibliography (once) at the document end. */
      insertBibliography: () => ReturnType;
    };
  }
}

export const Bibliography = Node.create({
  name: BIBLIOGRAPHY_NODE,
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,

  parseHTML() {
    return [{ tag: "div[data-livedoc-bibliography]" }];
  },

  renderHTML() {
    return ["div", mergeAttributes({ "data-livedoc-bibliography": "" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(LiveDocBibliographyView);
  },

  addCommands() {
    return {
      insertBibliography:
        () =>
        ({ chain, state }) => {
          const { doc } = state;
          let exists = false;
          doc.descendants((node) => {
            if (node.type.name === BIBLIOGRAPHY_NODE) exists = true;
            return exists ? false : undefined;
          });
          if (exists) return false;
          return chain()
            .insertContentAt(doc.content.size, [{ type: this.name }, { type: "paragraph" }])
            .run();
        },
    };
  },
});

export default Bibliography;
