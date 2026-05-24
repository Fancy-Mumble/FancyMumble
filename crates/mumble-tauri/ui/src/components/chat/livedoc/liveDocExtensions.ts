/**
 * Small custom Tiptap extensions used only inside Live Doc.
 *
 * - `Indent`   : adds an `indent` attribute (0-7) to paragraphs and
 *                headings + `indentBlock` / `outdentBlock` commands.
 * - `FontSize` : adds a `fontSize` attribute to the `textStyle` mark
 *                so the existing `@tiptap/extension-text-style`
 *                chain can carry an arbitrary `font-size` value.
 *
 * These are inline rather than separate packages because each is a
 * handful of lines and they don't have community Tiptap-3 versions
 * we can depend on safely yet.
 */

import { Extension } from "@tiptap/core";

declare module "@tiptap/core" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface Commands<ReturnType> {
    indent: {
      indentBlock: () => ReturnType;
      outdentBlock: () => ReturnType;
    };
    fontSize: {
      setFontSize: (fontSize: string) => ReturnType;
      unsetFontSize: () => ReturnType;
    };
  }
}

const INDENT_TYPES = ["paragraph", "heading"] as const;
const INDENT_STEP_PX = 32;
const MAX_INDENT_LEVEL = 7;

/** Adds an `indent` attribute and indent/outdent commands to block nodes. */
export const Indent = Extension.create({
  name: "liveDocIndent",

  addGlobalAttributes() {
    return [
      {
        types: [...INDENT_TYPES],
        attributes: {
          indent: {
            default: 0,
            parseHTML: (element) => {
              const pl = parseInt(
                (element as HTMLElement).style.paddingLeft || "0",
                10,
              );
              if (!Number.isFinite(pl) || pl <= 0) return 0;
              return Math.max(
                0,
                Math.min(MAX_INDENT_LEVEL, Math.round(pl / INDENT_STEP_PX)),
              );
            },
            renderHTML: (attributes) => {
              const indent = (attributes as { indent?: number }).indent ?? 0;
              if (!indent) return {};
              return { style: `padding-left: ${indent * INDENT_STEP_PX}px;` };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    const change = (delta: number) =>
      ({ state, dispatch, tr }: { state: import("@tiptap/pm/state").EditorState; dispatch: ((tr: import("@tiptap/pm/state").Transaction) => void) | undefined; tr: import("@tiptap/pm/state").Transaction }) => {
        let changed = false;
        const { from, to } = state.selection;
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (!(INDENT_TYPES as readonly string[]).includes(node.type.name)) {
            return true;
          }
          const cur = (node.attrs.indent as number | undefined) ?? 0;
          const next = Math.max(0, Math.min(MAX_INDENT_LEVEL, cur + delta));
          if (next !== cur) {
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next });
            changed = true;
          }
          return false;
        });
        if (changed && dispatch) dispatch(tr);
        return changed;
      };

    return {
      indentBlock: () => change(1),
      outdentBlock: () => change(-1),
    };
  },
});

/**
 * Stores a `font-size` value on the existing `textStyle` mark provided
 * by `@tiptap/extension-text-style`.  Mirrors how
 * `@tiptap/extension-color` plugs into the same mark.
 */
export const FontSize = Extension.create({
  name: "liveDocFontSize",

  addGlobalAttributes() {
    return [
      {
        types: ["textStyle"],
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element) =>
              (element as HTMLElement).style.fontSize || null,
            renderHTML: (attributes) => {
              const size = (attributes as { fontSize?: string | null }).fontSize;
              if (!size) return {};
              return { style: `font-size: ${size}` };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setFontSize:
        (size) =>
        ({ chain }) =>
          chain().setMark("textStyle", { fontSize: size }).run(),
      unsetFontSize:
        () =>
        ({ chain }) =>
          chain().setMark("textStyle", { fontSize: null }).removeEmptyTextStyle().run(),
    };
  },
});
