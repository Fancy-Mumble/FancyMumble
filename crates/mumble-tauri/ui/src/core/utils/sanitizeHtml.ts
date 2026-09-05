/**
 * Shared HTML sanitization for all user-generated content.
 *
 * This is the single source of truth for rendering untrusted HTML
 * (channel descriptions, server welcome text, user bios, chat
 * messages, etc.) safely inside the application.
 *
 * Security guarantees:
 *  - Only a safe allow-list of tags is permitted (DOMPurify).
 *  - All event handler attributes (on*) are stripped by DOMPurify.
 *  - No data attributes survive (ALLOW_DATA_ATTR: false).
 *  - <img> is allowed but `src` MUST be a data: image URL.
 *    External image URLs are removed to prevent IP leaks / tracking.
 *  - <a> is allowed but ONLY with http:// or https:// hrefs.
 *    All other schemes (javascript:, data:, vbscript:, etc.) are
 *    removed.  Allowed anchors are decorated with
 *    `data-external="true"` so the ExternalLinkGuard component can
 *    intercept clicks and show a confirmation dialog.
 *  - Inline CSS `style` attributes are restricted to safe visual
 *    properties only (no `position`, `url()`, `expression()`, etc.).
 */

import DOMPurify from "dompurify";

// -- Regular expressions ------------------------------------------------

/** Accepted image data: URL prefixes. */
const DATA_IMAGE_RE = /^data:image\/(png|jpe?g|gif|webp|avif|svg\+xml);base64,/i;

/** Only absolute http(s) URLs are allowed as link targets. */
const EXTERNAL_URL_RE = /^https?:\/\//i;

// -- DOMPurify allow-lists ----------------------------------------------

/**
 * Generous tag allow-list that covers bios, channel descriptions,
 * server welcome text, and chat messages.
 */
const ALLOWED_TAGS = [
  // Inline formatting
  "b",
  "i",
  "u",
  "s",
  "em",
  "strong",
  "small",
  "sub",
  "sup",
  "del",
  "ins",
  "mark",
  "abbr",
  "code",
  "span",
  "font",
  // Block structure
  "p",
  "br",
  "hr",
  "pre",
  "blockquote",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  // Lists
  "ul",
  "ol",
  "li",
  // Tables
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th",
  // Media (post-processed below)
  "img",
  "a",
];

const ALLOWED_ATTR = [
  "style",
  "class",
  "title",
  // img
  "src",
  "alt",
  "width",
  "height",
  // a
  "href",
  "target",
  "rel",
  // font (legacy Mumble HTML)
  "color",
  "size",
  "face",
  // table cells
  "colspan",
  "rowspan",
];

const PURIFY_CONFIG = {
  ALLOWED_TAGS,
  ALLOWED_ATTR,
  ALLOW_DATA_ATTR: false,
};

// -- CSS sanitization ---------------------------------------------------

/** CSS properties allowed in inline `style` attributes. */
const SAFE_CSS_PROPS = new Set([
  "color",
  "background-color",
  "background",
  "font-size",
  "font-weight",
  "font-style",
  "font-family",
  "text-decoration",
  // Inert for the same reason `box-shadow` is: lengths and a colour, nothing
  // fetched and nothing run. A lift under a display line on a busy background
  // is the one thing that makes it readable there, and there was no way to ask
  // for it.
  "text-shadow",
  "text-decoration-line",
  "text-decoration-color",
  "text-align",
  "text-transform",
  "text-indent",
  "line-height",
  "letter-spacing",
  "word-spacing",
  "word-break",
  "white-space",
  "vertical-align",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "border",
  "border-color",
  "border-width",
  "border-style",
  "border-top",
  "border-right",
  "border-bottom",
  "border-left",
  "border-radius",
  "border-collapse",
  "border-spacing",
  // Purely visual, and inert: a shadow is lengths, a colour and `inset`. It
  // cannot fetch anything or run anything, and `DANGEROUS_CSS_VALUE_RE` below
  // rejects any value that tries.
  //
  // It is on the list because it is how depth is drawn now - a 1px spread ring
  // instead of a border, an inset highlight along a panel's top edge - and
  // without it a design has no way to say either. What it *can* do is paint
  // outside its own box, so every surface that renders this markup clips its
  // container; see `WelcomeMarkup`.
  "box-shadow",
  // -- Filters and fitting ----------------------------------------------
  // `filter` and `backdrop-filter` take an SVG filter by `url()`, which is the
  // one thing that could fetch - and `DANGEROUS_CSS_VALUE_RE` below rejects any
  // value containing one, so what is left is blur, brightness, saturate and
  // their siblings. Frosted glass is a `backdrop-filter: blur()` over a
  // translucent fill and there was no way to say it at all.
  //
  // The WebKit prefix is not redundant: the client renders in WebKitGTK on
  // Linux, which still wants it.
  "filter",
  "backdrop-filter",
  "-webkit-backdrop-filter",
  // How a picture sits in the box it was given - the difference between a
  // photograph cropped to a band and one squashed into it.
  "object-fit",
  "object-position",
  "aspect-ratio",
  // The background layer's geometry. `background-image` is safe for the same
  // reason `background` already is: a gradient is a value, and a `url()` is
  // refused before it reaches here.
  "background-image",
  "background-size",
  "background-position",
  "background-repeat",
  // What a rounded box does with what is inside it. A `border-radius` clips the
  // element's own background and border, and nothing else - a picture or a
  // child sitting in the corner pokes straight through it. Clipping is the
  // other half of the property, and it is as inert as the first: geometry, no
  // fetching, no execution.
  "overflow",
  "overflow-x",
  "overflow-y",
  "display",
  // -- Flex layout ------------------------------------------------------
  // Inert, like every other property here: geometry, no fetching and no
  // execution. `display` alone was already allowed and is useless without the
  // rest - a `display:flex` whose `gap` and `flex-grow` are stripped is a row
  // of things huddled at the left, which is what a design asking for a pair of
  // full-width buttons used to get.
  //
  // `box-sizing` belongs with them: without it a `width:100%` element measures
  // its padding and its rule *on top of* the hundred percent and overflows
  // whatever it is inside.
  "box-sizing",
  "flex",
  "flex-basis",
  "flex-direction",
  "flex-flow",
  "flex-grow",
  "flex-shrink",
  "flex-wrap",
  "gap",
  "row-gap",
  "column-gap",
  "justify-content",
  "align-items",
  "align-content",
  "align-self",
  "order",
  "list-style",
  "list-style-type",
  "width",
  "max-width",
  "min-width",
  "height",
  "max-height",
  "min-height",
]);

/** CSS value patterns that are never allowed (can execute code or fetch). */
const DANGEROUS_CSS_VALUE_RE = /url\s*\(|expression\s*\(|javascript:|@import/i;

function sanitiseStyle(value: string): string {
  return value
    .split(";")
    .filter((decl) => {
      const colonIdx = decl.indexOf(":");
      if (colonIdx < 0) return false;
      const prop = decl.slice(0, colonIdx).trim().toLowerCase();
      const val = decl.slice(colonIdx + 1);
      return SAFE_CSS_PROPS.has(prop) && !DANGEROUS_CSS_VALUE_RE.test(val);
    })
    .join(";");
}

// -- Main sanitization function -----------------------------------------

/**
 * Sanitize untrusted HTML for safe rendering via `dangerouslySetInnerHTML`.
 *
 * 1. DOMPurify strips disallowed tags, attributes, and event handlers.
 * 2. `<img>` elements with external `src` are removed (only data: URLs
 *    with safe image MIME types are kept).
 * 3. `<a>` elements with non-http(s) `href` are unwrapped (text kept).
 *    Surviving anchors receive `data-external="true"`,
 *    `target="_blank"`, and `rel="noopener noreferrer"`.
 * 4. Inline `style` attributes are filtered to safe CSS properties.
 *
 * The returned string is safe to render inside an `ExternalLinkGuard`.
 */
export function sanitizeHtml(html: string): string {
  if (!html) return "";

  const fragment = DOMPurify.sanitize(html, {
    ...PURIFY_CONFIG,
    RETURN_DOM_FRAGMENT: true,
  }) as unknown as DocumentFragment;

  postProcess(fragment);

  const wrapper = document.createElement("div");
  wrapper.appendChild(fragment);
  return wrapper.innerHTML;
}

// -- Post-processing helpers --------------------------------------------

function postProcess(root: DocumentFragment | Element): void {
  // Validate img src - remove external URLs.
  for (const img of Array.from(root.querySelectorAll("img"))) {
    const src = img.getAttribute("src") ?? "";
    if (!DATA_IMAGE_RE.test(src)) {
      img.remove();
    }
  }

  // Validate anchor href - remove dangerous schemes, mark safe ones.
  for (const anchor of Array.from(root.querySelectorAll("a"))) {
    const href = anchor.getAttribute("href") ?? "";
    if (EXTERNAL_URL_RE.test(href)) {
      anchor.dataset["external"] = "true";
      anchor.setAttribute("target", "_blank");
      anchor.setAttribute("rel", "noopener noreferrer");
    } else {
      anchor.replaceWith(...Array.from(anchor.childNodes));
    }
  }

  // Sanitise inline styles.
  for (const el of Array.from(root.querySelectorAll("[style]"))) {
    const raw = el.getAttribute("style") ?? "";
    const safe = sanitiseStyle(raw);
    if (safe) {
      el.setAttribute("style", safe);
    } else {
      el.removeAttribute("style");
    }
  }
}
