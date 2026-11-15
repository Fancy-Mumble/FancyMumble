/**
 * What the rich-text field can hold, and how to tell when something cannot.
 *
 * A Tiptap editor is a *schema*, not an HTML box: markup it has no node or mark
 * for is dropped on parse, silently, and comes back out of `getHTML` missing.
 * That is fine for a bio, which is prose somebody typed into this client in the
 * first place. It is not fine for a server's welcome text, which is a document
 * an operator may have written by hand years ago, and which the editor would
 * quietly flatten the first time anyone touched it.
 *
 * So the extension set is a *preset* rather than a constant, and there is a way
 * to ask, before offering the editor at all, whether this particular markup
 * survives the round trip.
 */

import { generateHTML, generateJSON, type Extensions } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import Placeholder from "@tiptap/extension-placeholder";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import TextAlign from "@tiptap/extension-text-align";
import TiptapImage from "@tiptap/extension-image";

/**
 * How much document the field is willing to be.
 *
 * `prose` is a paragraph or two of formatted text - a bio, a channel
 * description, a status. `document` is something with structure: headings,
 * lists, alignment - the shape a welcome screen usually has.
 */
export type RichTextPreset = "prose" | "document";

/** The blocks `prose` deliberately does without. */
const PROSE_BLOCKS = {
  heading: false,
  blockquote: false,
  codeBlock: false,
  horizontalRule: false,
  bulletList: false,
  orderedList: false,
  listItem: false,
} as const;

/**
 * The extensions behind one preset.
 *
 * `placeholder` is part of the set rather than a prop because Tiptap resolves
 * extensions once; a set built without it cannot grow one later.
 */
export function richTextExtensions(preset: RichTextPreset = "prose", placeholder = ""): Extensions {
  const document = preset === "document";
  return [
    StarterKit.configure({
      // A bio is prose, not a document: the block nodes below would all be
      // dropped by the card's allow-list anyway, so they are not offered.
      ...(document ? {} : PROSE_BLOCKS),
      link: {
        // Opening a link from inside the editor is a click that should place
        // the caret, not leave the settings screen.
        openOnClick: false,
        // Nothing added that was not there. The defaults stamp every anchor
        // with `target="_blank" rel="noopener noreferrer nofollow"`, which
        // rewrites a document this component was only asked to edit - and
        // makes an untouched welcome text come back different from how it
        // arrived. What renders these is the sanitiser, which decides target
        // and rel for itself.
        HTMLAttributes: { target: null, rel: null },
      },
    }),
    TextStyle,
    Color,
    Placeholder.configure({ placeholder }),
    TiptapImage.configure({ inline: true, allowBase64: true }),
    // Everything below exists to *survive* the round trip as much as to be
    // typed: a welcome text that centres its heading and marks a word must not
    // lose either because this client's bio editor never needed them.
    //
    // Tables are deliberately absent, and that is not an omission. Tiptap's
    // table is an *editor* table: parsing one rewrites it into that model -
    // `<colgroup>`, `min-width` on every column, `colspan="1" rowspan="1"` on
    // every cell - so a document laid out with tables comes back structurally
    // different even when nothing was typed. A welcome screen built that way
    // is exactly the kind this must not touch, so it fails
    // `richTextSurvives` and is edited as source instead.
    ...(document
      ? [
          Highlight.configure({ multicolor: true }),
          Subscript,
          Superscript,
          TextAlign.configure({ types: ["heading", "paragraph"] }),
        ]
      : []),
  ];
}

/**
 * Whether `html` comes back out of the editor as the same document.
 *
 * The question a settings screen has to answer before it hands somebody a
 * WYSIWYG field: an editor that cannot represent what it was given will not say
 * so, it will just return less than it was handed, and the loss shows up as a
 * welcome screen that lost its layout the day an admin fixed a typo.
 *
 * Compared as **elements and text**, not as bytes. Two HTML strings that differ
 * in quoting, attribute order or `<br>` versus `<br/>` are the same document,
 * and a check that called those a loss would send every operator to the source
 * view for no reason. Attributes are compared, because losing
 * `style="text-align: center"` loses the layout while leaving the tags alone.
 *
 * Errs towards "no": anything this cannot parse or compare is treated as not
 * surviving, because the cost of being wrong runs one way. Saying a lossy
 * document is safe corrupts it; saying a safe one is lossy shows its author
 * some HTML.
 */
export function richTextSurvives(html: string, preset: RichTextPreset = "prose"): boolean {
  if (!html.trim()) return true;
  try {
    const extensions = richTextExtensions(preset);
    const round = generateHTML(generateJSON(html, extensions), extensions);
    return shapeOf(round) === shapeOf(html);
  } catch {
    return false;
  }
}

/**
 * A document reduced to what a reader would notice losing.
 *
 * Every element with its attributes, in document order, plus the text. Built
 * with the browser's own parser so that the two sides are normalised the same
 * way - which is the only reason comparing them means anything.
 */
function shapeOf(html: string): string {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const elements = [...parsed.body.querySelectorAll("*")].map((element) => {
    const attributes = [...element.attributes]
      .map((attribute) => `${attribute.name}=${normaliseValue(attribute.value)}`)
      .sort()
      .join(";");
    return `${element.tagName.toLowerCase()}[${attributes}]`;
  });
  const text = (parsed.body.textContent ?? "").replaceAll(/\s+/g, " ").trim();
  return `${elements.join(">")}|${text}`;
}

/** `text-align: center;` and `text-align:center` are the same instruction. */
function normaliseValue(value: string): string {
  return value.replaceAll(/\s+/g, " ").replace(/;\s*$/, "").trim();
}
