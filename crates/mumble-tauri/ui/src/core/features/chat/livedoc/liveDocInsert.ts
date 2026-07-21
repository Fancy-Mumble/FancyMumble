/**
 * liveDocInsert - the Tiptap extensions backing the Word-style "Insert" tab.
 *
 * To keep the schema small, related insertables share a node:
 *
 *  - `LiveDocBox`   - an editable bordered container; `variant` switches
 *                     between a plain Text Box and decorative Word "Art".
 *  - `LiveDocEmbed` - a leaf "object" whose `kind` renders a signature line,
 *                     a signature-fields block, an embedded object/file card,
 *                     an online-video iframe, or a 3D-model card.
 *  - `Comment`      - an inline mark that annotates a span with a note.
 *  - `DropCap`      - a paragraph/heading attribute that enlarges the first
 *                     letter (rendered via CSS `::first-letter`).
 *
 * Every node renders to a `<div>`/`<span>` carrying `data-livedoc-*`
 * attributes, so the markdown round-trip serializer preserves them as raw
 * HTML and the editor re-parses them losslessly.
 */

import { Node, Mark, Extension, mergeAttributes } from "@tiptap/core";
import type { DOMOutputSpec } from "@tiptap/pm/model";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";

// ---------------------------------------------------------------------------
// Shared command typing
// ---------------------------------------------------------------------------

export type LiveDocBoxVariant = "textbox" | "wordart";
export type LiveDocEmbedKind =
  | "signatureLine"
  | "signatureFields"
  | "signatureDigital"
  | "object"
  | "video"
  | "model3d";

export interface LiveDocEmbedAttrs {
  kind: LiveDocEmbedKind;
  /** Resource URL (video embed / 3D model / object download). */
  src?: string;
  /** Display title / caption. */
  title?: string;
  /** Signer name (signature line / digital signature). */
  name?: string;
  /** File name (object embed). */
  fileName?: string;
  /** Presentation frame for video embeds (plain / rounded / shadow / bordered). */
  frame?: string;
  // -- digital signature payload (kind === "signatureDigital") --
  /** Public-key fingerprint (display). */
  fingerprint?: string;
  /** ISO timestamp the document was signed. */
  signedAt?: string;
  /** Detached signature, base64. */
  signature?: string;
  /** Signer public key (SPKI DER), base64. */
  publicKey?: string;
  /** SHA-256 of the signed document text, hex. */
  docHash?: string;
  /** Signature algorithm id. */
  algorithm?: string;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    liveDocInsert: {
      insertTextBox: () => ReturnType;
      insertWordArt: (text: string) => ReturnType;
      insertLiveDocEmbed: (attrs: LiveDocEmbedAttrs) => ReturnType;
      setComment: (note: string) => ReturnType;
      unsetComment: () => ReturnType;
      toggleDropCap: () => ReturnType;
    };
  }
}

// ---------------------------------------------------------------------------
// LiveDocBox - editable container (Text Box / Word Art)
// ---------------------------------------------------------------------------

export const LiveDocBox = Node.create({
  name: "liveDocBox",
  group: "block",
  content: "block+",
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      variant: {
        default: "textbox" as LiveDocBoxVariant,
        parseHTML: (el) => (el.getAttribute("data-livedoc-box") as LiveDocBoxVariant) || "textbox",
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-livedoc-box]" }];
  },

  // The box is `isolating`, so a plain Backspace/Delete at its edge can never
  // join it away - which left an inserted-but-empty box impossible to remove.
  // Handle the deletion explicitly: remove a node-selected box, or remove an
  // empty box the caret sits inside (the just-inserted state).
  addKeyboardShortcuts() {
    const removeBox = () => {
      const { state } = this.editor;
      const { selection } = state;

      if (selection instanceof NodeSelection && selection.node.type === this.type) {
        return this.editor.commands.deleteSelection();
      }

      if (!selection.empty) return false;

      const { $from } = selection;
      for (let depth = $from.depth; depth >= 1; depth--) {
        const node = $from.node(depth);
        if (node.type !== this.type) continue;
        // Only auto-remove while empty; a box with content is cleared first.
        if (node.textContent.length > 0) return false;
        const from = $from.before(depth);
        const to = from + node.nodeSize;
        return this.editor
          .chain()
          .focus()
          .command(({ tr }) => {
            tr.delete(from, to);
            // Never leave the document without a block to type in.
            if (tr.doc.childCount === 0) {
              const para = state.schema.nodes.paragraph?.createAndFill();
              if (para) {
                tr.insert(0, para);
                tr.setSelection(TextSelection.create(tr.doc, 1));
              }
            }
            return true;
          })
          .run();
      }
      return false;
    };

    return { Backspace: removeBox, Delete: removeBox };
  },

  renderHTML({ node, HTMLAttributes }) {
    const variant = (node.attrs.variant as LiveDocBoxVariant) ?? "textbox";
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-livedoc-box": variant,
        class: `ld-box ld-box-${variant}`,
      }),
      0,
    ];
  },

  addCommands() {
    return {
      insertTextBox:
        () =>
        ({ chain }) =>
          chain()
            .focus()
            .insertContent({
              type: this.name,
              attrs: { variant: "textbox" },
              content: [{ type: "paragraph" }],
            })
            .run(),
      insertWordArt:
        (text: string) =>
        ({ chain }) =>
          chain()
            .focus()
            .insertContent({
              type: this.name,
              attrs: { variant: "wordart" },
              content: [
                {
                  type: "paragraph",
                  content: text ? [{ type: "text", text }] : [],
                },
              ],
            })
            .run(),
    };
  },
});

// ---------------------------------------------------------------------------
// LiveDocEmbed - leaf object (signature / object / video / 3D model)
// ---------------------------------------------------------------------------

/** Extract a YouTube / Vimeo embeddable URL from a watch/share URL, or null. */
export function toVideoEmbedUrl(raw: string): string | null {
  const url = raw.trim();
  const yt = /(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{6,})/.exec(url);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  const vimeo = /vimeo\.com\/(?:video\/)?(\d+)/.exec(url);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
  // Already an embed/player URL or a direct file - use as-is over https.
  if (/^https?:\/\//.test(url)) return url;
  return null;
}

function embedDom(attrs: LiveDocEmbedAttrs): DOMOutputSpec[] {
  const { kind } = attrs;
  const safeSrc = attrs.src ?? "";
  if (kind === "video") {
    const embed = toVideoEmbedUrl(safeSrc) ?? safeSrc;
    const frame = attrs.frame && attrs.frame !== "plain" ? ` ld-embed-frame-${attrs.frame}` : "";
    return [
      ["div", { class: `ld-embed-video${frame}` },
        ["iframe", {
          src: embed,
          frameborder: "0",
          allow: "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture",
          allowfullscreen: "true",
          loading: "lazy",
        }],
      ],
    ];
  }
  if (kind === "model3d") {
    return [
      ["div", { class: "ld-embed-card ld-embed-model" },
        ["span", { class: "ld-embed-icon", "aria-hidden": "true" }, "◰"],
        ["span", { class: "ld-embed-meta" },
          ["span", { class: "ld-embed-title" }, attrs.title || attrs.fileName || "3D model"],
          ["a", { class: "ld-embed-link", href: safeSrc, target: "_blank", rel: "noopener noreferrer" }, safeSrc],
        ],
      ],
    ];
  }
  if (kind === "object") {
    const meta: DOMOutputSpec[] = [
      ["span", { class: "ld-embed-title" }, attrs.fileName || attrs.title || "Object"],
    ];
    if (safeSrc) {
      meta.push([
        "a",
        { class: "ld-embed-link", href: safeSrc, download: attrs.fileName || "", target: "_blank", rel: "noopener noreferrer" },
        "Open",
      ]);
    }
    return [
      ["div", { class: "ld-embed-card ld-embed-object" },
        ["span", { class: "ld-embed-icon", "aria-hidden": "true" }, "🗎"],
        ["span", { class: "ld-embed-meta" }, ...meta],
      ],
    ];
  }
  if (kind === "signatureFields") {
    const field = (label: string) => ["div", { class: "ld-sig-field" },
      ["span", { class: "ld-sig-rule" }],
      ["span", { class: "ld-sig-caption" }, label],
    ];
    return [
      ["div", { class: "ld-sig-fields" },
        field("Signature"),
        field("Name"),
        field("Date"),
      ],
    ];
  }
  if (kind === "signatureDigital") {
    const when = attrs.signedAt ? new Date(attrs.signedAt).toLocaleString() : "";
    return [
      ["div", { class: "ld-sig-digital" },
        ["span", { class: "ld-sig-digital-seal", "aria-hidden": "true" }, "🔏"],
        ["span", { class: "ld-sig-digital-body" },
          ["span", { class: "ld-sig-digital-name" }, `Digitally signed by ${attrs.name || "Unknown"}`],
          ["span", { class: "ld-sig-digital-meta" }, `Key ${attrs.fingerprint || "-"}`],
          ["span", { class: "ld-sig-digital-meta" }, when ? `Signed ${when}` : ""],
        ],
        ["span", { class: "ld-sig-digital-badge", title: attrs.algorithm || "" }, "✓ Verified"],
      ],
    ];
  }
  // signatureLine (default)
  return [
    ["div", { class: "ld-sig-line" },
      ["span", { class: "ld-sig-x", "aria-hidden": "true" }, "✕"],
      ["span", { class: "ld-sig-rule" }],
      ["span", { class: "ld-sig-caption" }, attrs.name || attrs.title || "Signature"],
    ],
  ];
}

export const LiveDocEmbed = Node.create({
  name: "liveDocEmbed",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      kind: { default: "signatureLine" as LiveDocEmbedKind },
      src: { default: "" },
      title: { default: "" },
      name: { default: "" },
      fileName: { default: "" },
      frame: { default: "" },
      fingerprint: { default: "" },
      signedAt: { default: "" },
      signature: { default: "" },
      publicKey: { default: "" },
      docHash: { default: "" },
      algorithm: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-livedoc-embed]",
        getAttrs: (el) => ({
          kind: (el.getAttribute("data-livedoc-embed") as LiveDocEmbedKind) || "signatureLine",
          src: el.getAttribute("data-src") ?? "",
          title: el.getAttribute("data-title") ?? "",
          name: el.getAttribute("data-name") ?? "",
          fileName: el.getAttribute("data-file-name") ?? "",
          frame: el.getAttribute("data-frame") ?? "",
          fingerprint: el.getAttribute("data-fingerprint") ?? "",
          signedAt: el.getAttribute("data-signed-at") ?? "",
          signature: el.getAttribute("data-signature") ?? "",
          publicKey: el.getAttribute("data-public-key") ?? "",
          docHash: el.getAttribute("data-doc-hash") ?? "",
          algorithm: el.getAttribute("data-algorithm") ?? "",
        }),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const attrs = node.attrs as LiveDocEmbedAttrs;
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-livedoc-embed": attrs.kind,
        "data-src": attrs.src ?? "",
        "data-title": attrs.title ?? "",
        "data-name": attrs.name ?? "",
        "data-file-name": attrs.fileName ?? "",
        "data-frame": attrs.frame ?? "",
        "data-fingerprint": attrs.fingerprint ?? "",
        "data-signed-at": attrs.signedAt ?? "",
        "data-signature": attrs.signature ?? "",
        "data-public-key": attrs.publicKey ?? "",
        "data-doc-hash": attrs.docHash ?? "",
        "data-algorithm": attrs.algorithm ?? "",
        class: `ld-embed ld-embed-${attrs.kind}`,
        contenteditable: "false",
      }),
      ...embedDom(attrs),
    ];
  },

  addCommands() {
    return {
      insertLiveDocEmbed:
        (attrs: LiveDocEmbedAttrs) =>
        ({ chain }) =>
          chain().focus().insertContent({ type: this.name, attrs }).run(),
    };
  },
});

// ---------------------------------------------------------------------------
// Comment - inline annotation mark
// ---------------------------------------------------------------------------

export const Comment = Mark.create({
  name: "comment",
  inclusive: false,

  addAttributes() {
    return {
      note: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-livedoc-comment") ?? "",
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-livedoc-comment]" }];
  },

  renderHTML({ mark, HTMLAttributes }) {
    const note = (mark.attrs.note as string) ?? "";
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-livedoc-comment": note,
        class: "ld-comment",
        title: note,
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setComment:
        (note: string) =>
        ({ chain }) =>
          chain().setMark(this.name, { note }).run(),
      unsetComment:
        () =>
        ({ chain }) =>
          chain().unsetMark(this.name).run(),
    };
  },
});

// ---------------------------------------------------------------------------
// DropCap - enlarge the first letter of a paragraph / heading
// ---------------------------------------------------------------------------

export const DropCap = Extension.create({
  name: "dropCap",

  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading"],
        attributes: {
          dropCap: {
            default: false,
            parseHTML: (el) => el.getAttribute("data-dropcap") === "true",
            renderHTML: (attrs) => (attrs.dropCap ? { "data-dropcap": "true" } : {}),
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      toggleDropCap:
        () =>
        ({ editor, chain }) => {
          const active = Boolean(editor.getAttributes("paragraph").dropCap || editor.getAttributes("heading").dropCap);
          return chain().updateAttributes("paragraph", { dropCap: !active }).run();
        },
    };
  },
});
