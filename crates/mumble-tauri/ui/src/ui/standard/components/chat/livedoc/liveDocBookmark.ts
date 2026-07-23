/**
 * Bookmark - a named, inline anchor for Live Doc (roadmap item 2).
 *
 * A bookmark marks a location with a stable id + human label so a
 * cross-reference can point at it.  Rendered as a small inline pill via
 * [`LiveDocBookmarkView`].  Serialised to/from Markdown as
 * `<span data-livedoc-bookmark data-id data-label></span>` so it
 * survives an export/import round-trip.
 */

import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import LiveDocBookmarkView from "./LiveDocBookmarkView";

/** Generate a stable-ish unique id for a bookmark/caption node. */
export function newRefId(prefix: string): string {
  const rand =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}-${rand}`;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    liveDocBookmark: {
      /** Insert a named bookmark anchor at the caret. */
      insertBookmark: (attrs: { bookmarkId: string; label: string }) => ReturnType;
    };
  }
}

export const Bookmark = Node.create({
  name: "bookmark",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      bookmarkId: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-id") ?? "",
        renderHTML: (attrs) => ({ "data-id": attrs.bookmarkId as string }),
      },
      label: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-label") ?? "",
        renderHTML: (attrs) => ({ "data-label": attrs.label as string }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-livedoc-bookmark]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { "data-livedoc-bookmark": "" }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(LiveDocBookmarkView);
  },

  addCommands() {
    return {
      insertBookmark:
        (attrs) =>
        ({ chain }) =>
          chain()
            .insertContent({ type: this.name, attrs })
            .run(),
    };
  },
});

export default Bookmark;
