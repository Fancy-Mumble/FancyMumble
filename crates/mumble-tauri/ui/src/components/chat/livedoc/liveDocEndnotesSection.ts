/**
 * EndnotesSection - an in-document, auto-generated "Endnotes" block
 * (roadmap item 3).  Rendered as an atomic block leaf via a React node
 * view ([`LiveDocEndnotesSectionView`]) that reads the live endnote list
 * and lets the user edit each note's text and jump back to its marker.
 *
 * Serialised to/from Markdown as `<div data-livedoc-endnotes></div>`;
 * the note bodies live on the marker nodes, so the persisted section
 * placeholder carries no stale text.
 */

import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { ENDNOTES_SECTION_NODE } from "./liveDocEndnotes";
import LiveDocEndnotesSectionView from "./LiveDocEndnotesSectionView";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    liveDocEndnotesSection: {
      /** Insert the generated endnotes section (once) at the document end. */
      insertEndnotesSection: () => ReturnType;
    };
  }
}

export const EndnotesSection = Node.create({
  name: ENDNOTES_SECTION_NODE,
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,

  parseHTML() {
    return [{ tag: "div[data-livedoc-endnotes]" }];
  },

  renderHTML() {
    return ["div", mergeAttributes({ "data-livedoc-endnotes": "" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(LiveDocEndnotesSectionView);
  },

  addCommands() {
    return {
      insertEndnotesSection:
        () =>
        ({ chain, state }) => {
          const { doc } = state;
          let exists = false;
          doc.descendants((node) => {
            if (node.type.name === ENDNOTES_SECTION_NODE) exists = true;
            return exists ? false : undefined;
          });
          if (exists) return false;
          return chain()
            .insertContentAt(doc.content.size, [
              { type: this.name },
              { type: "paragraph" },
            ])
            .run();
        },
    };
  },
});

export default EndnotesSection;
