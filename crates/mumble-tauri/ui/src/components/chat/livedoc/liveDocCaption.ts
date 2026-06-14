/**
 * Caption - an auto-numbered caption block for figures, tables and
 * equations (roadmap item 2).
 *
 * The visible number ("Figure 1", "Table 2", ...) is generated live by
 * [`LiveDocCaptionView`] from the caption's position among same-kind
 * captions, so inserting or deleting a caption renumbers the rest
 * automatically.  Only the editable caption text is stored; the number
 * is never persisted.
 *
 * Serialised to/from Markdown as
 * `<figcaption data-livedoc-caption data-kind data-id>text</figcaption>`.
 */

import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { CAPTION_KINDS, type CaptionKind } from "./liveDocReferences";
import { newRefId } from "./liveDocBookmark";
import LiveDocCaptionView from "./LiveDocCaptionView";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    liveDocCaption: {
      /** Insert an auto-numbered caption of the given kind at the caret. */
      insertCaption: (kind: CaptionKind) => ReturnType;
    };
  }
}

function normaliseKind(value: unknown): CaptionKind {
  return (CAPTION_KINDS as readonly string[]).includes(value as string)
    ? (value as CaptionKind)
    : "figure";
}

export const Caption = Node.create({
  name: "caption",
  group: "block",
  content: "inline*",
  defining: true,
  draggable: false,

  addAttributes() {
    return {
      kind: {
        default: "figure",
        parseHTML: (el) => normaliseKind(el.getAttribute("data-kind")),
        renderHTML: (attrs) => ({ "data-kind": attrs.kind as string }),
      },
      captionId: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-id") ?? "",
        renderHTML: (attrs) => ({ "data-id": attrs.captionId as string }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "figcaption[data-livedoc-caption]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "figcaption",
      mergeAttributes(HTMLAttributes, { "data-livedoc-caption": "" }),
      0,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(LiveDocCaptionView);
  },

  addCommands() {
    return {
      insertCaption:
        (kind) =>
        ({ chain }) =>
          chain()
            .insertContent({
              type: this.name,
              attrs: { kind: normaliseKind(kind), captionId: newRefId("cap") },
            })
            .run(),
    };
  },
});

export default Caption;
