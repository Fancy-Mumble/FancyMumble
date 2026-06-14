/**
 * EndnoteRef - an inline superscript endnote marker (roadmap item 3).
 *
 * The marker carries a stable `noteId` and the note `text`; its visible
 * number is generated live by [`LiveDocEndnoteRefView`] from its order
 * among markers, so inserting or deleting a marker renumbers the rest.
 *
 * Serialised to/from Markdown as
 * `<sup data-livedoc-endnote data-id data-text></sup>`.
 */

import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { newRefId } from "./liveDocBookmark";
import { ENDNOTE_REF_NODE } from "./liveDocEndnotes";
import LiveDocEndnoteRefView from "./LiveDocEndnoteRefView";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    liveDocEndnote: {
      /** Insert an endnote marker at the caret. */
      insertEndnote: () => ReturnType;
    };
  }
}

export const EndnoteRef = Node.create({
  name: ENDNOTE_REF_NODE,
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      noteId: {
        default: "",
        parseHTML: (el) => el.dataset.id ?? "",
        renderHTML: (attrs) => ({ "data-id": attrs.noteId as string }),
      },
      text: {
        default: "",
        parseHTML: (el) => el.dataset.text ?? "",
        renderHTML: (attrs) => ({ "data-text": attrs.text as string }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "sup[data-livedoc-endnote]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "sup",
      mergeAttributes(HTMLAttributes, { "data-livedoc-endnote": "" }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(LiveDocEndnoteRefView);
  },

  addCommands() {
    return {
      insertEndnote:
        () =>
        ({ chain }) =>
          chain()
            .insertContent({
              type: this.name,
              attrs: { noteId: newRefId("en"), text: "" },
            })
            .run(),
    };
  },
});

export default EndnoteRef;
