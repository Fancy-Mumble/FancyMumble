/**
 * Citation - an inline citation that references one or more bibliography
 * sources (or is an unset named placeholder).  The displayed text is
 * resolved live and per-style by [`LiveDocCitationView`] from the shared
 * citation snapshot, so switching styles or editing a source updates every
 * citation automatically.
 *
 * Stored attrs: `items` (JSON string of `CitationItemRef[]`) and
 * `placeholder` (a tag name when no source is set).  Serialised to/from
 * Markdown as `<span data-livedoc-citation data-items data-placeholder>`.
 */

import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import LiveDocCitationView from "./LiveDocCitationView";
import { CITATION_NODE, type CitationItemRef } from "./liveDocCitations";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    liveDocCitation: {
      /** Insert a citation referencing the given sources. */
      insertCitation: (items: CitationItemRef[]) => ReturnType;
      /** Insert an unset named placeholder citation. */
      insertCitationPlaceholder: (tag: string) => ReturnType;
    };
  }
}

export const Citation = Node.create({
  name: CITATION_NODE,
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      items: {
        default: "[]",
        parseHTML: (el) => el.getAttribute("data-items") ?? "[]",
        renderHTML: (attrs) => ({ "data-items": String(attrs.items ?? "[]") }),
      },
      placeholder: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-placeholder") ?? "",
        renderHTML: (attrs) => ({ "data-placeholder": String(attrs.placeholder ?? "") }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-livedoc-citation]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-livedoc-citation": "" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(LiveDocCitationView);
  },

  addCommands() {
    return {
      insertCitation:
        (items) =>
        ({ chain }) =>
          chain()
            .insertContent({ type: this.name, attrs: { items: JSON.stringify(items), placeholder: "" } })
            .run(),
      insertCitationPlaceholder:
        (tag) =>
        ({ chain }) =>
          chain()
            .insertContent({ type: this.name, attrs: { items: "[]", placeholder: tag } })
            .run(),
    };
  },
});

export default Citation;
