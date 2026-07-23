/**
 * LiveDocImage - Tiptap image extension with Google-Docs-style
 * resize handles, rotate handle, and a floating wrap-mode menu.
 *
 * Extends `@tiptap/extension-image` with four extra attributes:
 *
 *   * `width`    - rendered width in CSS pixels (number | null)
 *   * `height`   - rendered height in CSS pixels (number | null)
 *   * `rotation` - degrees, signed integer (-360 - 360)
 *   * `wrap`     - one of "inline" | "wrap" | "break" | "behind" | "front"
 *
 * Renders via a React node view ([`LiveDocImageView`]) so the
 * handles and the wrap-mode popover can be plain React components.
 */

import { ReactNodeViewRenderer } from "@tiptap/react";
import TiptapImage from "@tiptap/extension-image";

import LiveDocImageView from "./LiveDocImageView";

export type ImageWrapMode = "inline" | "wrap" | "wrapRight" | "break" | "behind" | "front";

export const IMAGE_WRAP_MODES: readonly ImageWrapMode[] = [
  "inline",
  "wrap",
  "wrapRight",
  "break",
  "behind",
  "front",
];

export const LiveDocImage = TiptapImage.extend({
  name: "liveDocImage",

  draggable: true,
  selectable: true,
  // Keep parsing/output as a plain <img> so the markdown export and
  // the file-server-bridge persistence layer don't see any custom tag.
  inline: false,
  group: "block",

  addAttributes() {
    const base = this.parent?.() ?? {};
    return {
      ...base,
      width: {
        default: null as number | null,
        parseHTML: (element) => {
          const w = (element as HTMLElement).getAttribute("width");
          if (w) {
            const n = parseInt(w, 10);
            return Number.isFinite(n) ? n : null;
          }
          const style = (element as HTMLElement).style.width;
          if (style && style.endsWith("px")) {
            const n = parseInt(style, 10);
            return Number.isFinite(n) ? n : null;
          }
          return null;
        },
        renderHTML: (attrs) => {
          const w = (attrs as { width?: number | null }).width;
          return w ? { width: String(w) } : {};
        },
      },
      height: {
        default: null as number | null,
        parseHTML: (element) => {
          const h = (element as HTMLElement).getAttribute("height");
          if (h) {
            const n = parseInt(h, 10);
            return Number.isFinite(n) ? n : null;
          }
          const style = (element as HTMLElement).style.height;
          if (style && style.endsWith("px")) {
            const n = parseInt(style, 10);
            return Number.isFinite(n) ? n : null;
          }
          return null;
        },
        renderHTML: (attrs) => {
          const h = (attrs as { height?: number | null }).height;
          return h ? { height: String(h) } : {};
        },
      },
      rotation: {
        default: 0,
        parseHTML: (element) => {
          const v = (element as HTMLElement).getAttribute("data-rotation");
          if (!v) return 0;
          const n = parseInt(v, 10);
          return Number.isFinite(n) ? n : 0;
        },
        renderHTML: (attrs) => {
          const r = (attrs as { rotation?: number }).rotation ?? 0;
          return r ? { "data-rotation": String(r) } : {};
        },
      },
      wrap: {
        default: "inline" as ImageWrapMode,
        parseHTML: (element) => {
          const v = (element as HTMLElement).getAttribute("data-wrap");
          return (IMAGE_WRAP_MODES as readonly string[]).includes(v ?? "")
            ? (v as ImageWrapMode)
            : "inline";
        },
        renderHTML: (attrs) => {
          const w = (attrs as { wrap?: ImageWrapMode }).wrap ?? "inline";
          return w !== "inline" ? { "data-wrap": w } : {};
        },
      },
      // Free-position offset from the top-left of the `.editorPage`
      // page surface.  Only honoured when `wrap` is not "inline".
      x: {
        default: null as number | null,
        parseHTML: (element) => {
          const v = (element as HTMLElement).getAttribute("data-x");
          if (!v) return null;
          const n = parseInt(v, 10);
          return Number.isFinite(n) ? n : null;
        },
        renderHTML: (attrs) => {
          const x = (attrs as { x?: number | null }).x;
          return x != null ? { "data-x": String(x) } : {};
        },
      },
      y: {
        default: null as number | null,
        parseHTML: (element) => {
          const v = (element as HTMLElement).getAttribute("data-y");
          if (!v) return null;
          const n = parseInt(v, 10);
          return Number.isFinite(n) ? n : null;
        },
        renderHTML: (attrs) => {
          const y = (attrs as { y?: number | null }).y;
          return y != null ? { "data-y": String(y) } : {};
        },
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(LiveDocImageView);
  },
});

export default LiveDocImage;
