/**
 * CrossReference - an inline reference that points at a bookmark,
 * heading or caption and renders that target's live text/number
 * (roadmap item 2).  Clicking it scrolls the editor to the target.
 *
 * The node stores only the stable target id; the displayed text is
 * resolved live by [`LiveDocCrossRefView`], so renaming a heading or
 * renumbering a figure updates every reference automatically.
 *
 * Serialised to/from Markdown as
 * `<span data-livedoc-xref data-target></span>`.
 */

import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import LiveDocCrossRefView from "./LiveDocCrossRefView";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    liveDocCrossRef: {
      /** Insert a cross-reference to the target with `targetId`. */
      insertCrossReference: (targetId: string) => ReturnType;
    };
  }
}

export const CrossReference = Node.create({
  name: "crossReference",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      targetId: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-target") ?? "",
        renderHTML: (attrs) => ({ "data-target": attrs.targetId as string }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-livedoc-xref]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-livedoc-xref": "" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(LiveDocCrossRefView);
  },

  addCommands() {
    return {
      insertCrossReference:
        (targetId) =>
        ({ chain }) =>
          chain()
            .insertContent({ type: this.name, attrs: { targetId } })
            .run(),
    };
  },
});

export default CrossReference;
