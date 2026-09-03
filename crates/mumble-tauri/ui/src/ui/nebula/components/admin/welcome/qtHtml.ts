/**
 * Markup for Mumble 1.5 and older, which draws a greeting with Qt.
 *
 * Those clients hand the welcome text to `QTextDocument`, which renders a
 * subset of HTML 4 and CSS 2.1 - the shape of the web in about 2003. What that
 * means in practice, and why a greeting that looks like a card in this client
 * arrives as a left-aligned column there:
 *
 * * **No flexbox, no grid.** Two things side by side is a `<table>` with two
 *   `<td>`s, and there is no other way to do it.
 * * **No `border-radius`, no `box-shadow`.** A rounded card is a square one.
 * * **No buttons.** There is no `<button>`, and a `<div>` styled like one is a
 *   div. A cell with a background colour and a bold link in it is what a
 *   button is, and it does read as one.
 * * **A small CSS allow-list**, and anything outside it is dropped silently -
 *   which is the dangerous part, because the markup still renders, just
 *   wrong.
 * * **Some tags simply do not exist**: `<mark>`, and every HTML5 semantic tag.
 *   Qt keeps their contents and drops the styling, so a highlighted word turns
 *   into a plain one.
 *
 * So this module compiles the same bands the modern renderer draws into markup
 * Qt can actually lay out, and downgrades any prose written in the WYSIWYG on
 * the way through. It is not a fallback that loses the design - it is the
 * design, expressed in the only vocabulary the old client has.
 *
 * Everything here is deliberately verbose and old-fashioned: `<font>` tags,
 * `bgcolor`, `align="center"`, nested tables. That is not carelessness; those
 * are the constructs Qt is most reliable about, and a stylesheet written the
 * modern way would be dropped without a word.
 */

import { escapeHtml } from "./markup";
import { isWebUrl, type Section } from "./layout";

/**
 * The tags Qt's rich text knows.
 *
 * From Qt's "Supported HTML Subset". Anything else is *unwrapped* rather than
 * deleted - Qt keeps the text inside an unknown tag, and so do we, because the
 * words are what somebody wrote and the tag was only how they styled them.
 */
const QT_TAGS = new Set([
  "A",
  "ADDRESS",
  "B",
  "BIG",
  "BLOCKQUOTE",
  "BODY",
  "BR",
  "CENTER",
  "CITE",
  "CODE",
  "DD",
  "DFN",
  "DIV",
  "DL",
  "DT",
  "EM",
  "FONT",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HR",
  "I",
  "IMG",
  "KBD",
  "LI",
  "NOBR",
  "OL",
  "P",
  "PRE",
  "S",
  "SAMP",
  "SMALL",
  "SPAN",
  "STRONG",
  "SUB",
  "SUP",
  "TABLE",
  "TBODY",
  "TD",
  "TFOOT",
  "TH",
  "THEAD",
  "TR",
  "TT",
  "U",
  "UL",
  "VAR",
]);

/**
 * Tags with a Qt equivalent, rather than none.
 *
 * `<mark>` is the one that matters: the WYSIWYG's highlight button writes one,
 * Qt has never heard of it, and unwrapped it would quietly turn a highlighted
 * phrase back into ordinary text.
 */
const QT_EQUIVALENT: Record<string, { tag: string; style?: string }> = {
  MARK: { tag: "span", style: "background-color:#ffee55;color:#101010" },
  DEL: { tag: "s" },
  INS: { tag: "u" },
  STRIKE: { tag: "s" },
};

/**
 * The CSS properties Qt reads.
 *
 * A short list on purpose. Qt drops what it does not know without complaining,
 * so anything left in here that it cannot use is a line of markup that costs
 * bytes against the server's 4096-character cap and does nothing.
 */
const QT_CSS = new Set([
  "background-color",
  "background",
  "color",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "text-decoration",
  "text-align",
  "text-indent",
  "vertical-align",
  "white-space",
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
  "border-collapse",
  "list-style-type",
  "width",
  "height",
]);

/** The attributes worth keeping, by tag. Everything else goes. */
const QT_ATTRS = new Set([
  "style",
  "href",
  "src",
  "alt",
  "width",
  "height",
  "align",
  "valign",
  "bgcolor",
  "border",
  "cellpadding",
  "cellspacing",
  "colspan",
  "rowspan",
  "color",
  "size",
  "face",
]);

/**
 * Some markup, reduced to what Qt will actually draw.
 *
 * Structural rather than textual: parsed, walked, and re-serialised, because
 * the alternative is a pile of regexes over angle brackets and `<p title="a >
 * b">` defeats the first of them.
 */
export function qtSafe(html: string): string {
  if (html.trim() === "") return "";
  const parsed = new DOMParser().parseFromString(html, "text/html");
  clean(parsed.body);
  return parsed.body.innerHTML;
}

function clean(parent: Element): void {
  for (const child of Array.from(parent.children)) {
    clean(child);

    const swap = QT_EQUIVALENT[child.tagName];
    if (swap) {
      const replacement = parent.ownerDocument.createElement(swap.tag);
      if (swap.style) replacement.setAttribute("style", swap.style);
      replacement.append(...Array.from(child.childNodes));
      child.replaceWith(replacement);
      continue;
    }

    if (!QT_TAGS.has(child.tagName)) {
      // Unwrapped, not deleted: Qt keeps the words inside a tag it does not
      // know, and so does this - the words are what somebody wrote.
      child.replaceWith(...Array.from(child.childNodes));
      continue;
    }

    for (const attribute of Array.from(child.attributes)) {
      if (!QT_ATTRS.has(attribute.name.toLowerCase())) child.removeAttribute(attribute.name);
    }
    const style = child.getAttribute("style");
    if (style !== null) {
      const kept = qtStyle(style);
      if (kept) child.setAttribute("style", kept);
      else child.removeAttribute("style");
    }
  }
}

/**
 * What Qt would silently drop from this markup.
 *
 * The reason this is worth having separately from `qtSafe`: an operator can
 * paste markup into a prose band, and the failure mode is not an error - Qt
 * renders it, just without whatever it did not understand. A list of what will
 * go missing is a thing they can act on; a greeting that quietly lost its
 * colour on half the clients is not.
 *
 * Named as tags and properties rather than counted, because "3 problems" tells
 * nobody which line to look at.
 */
export function qtViolations(html: string): string[] {
  if (html.trim() === "") return [];
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const found = new Set<string>();
  for (const element of Array.from(parsed.body.querySelectorAll("*"))) {
    if (!QT_TAGS.has(element.tagName) && !QT_EQUIVALENT[element.tagName]) {
      found.add(`<${element.tagName.toLowerCase()}>`);
    }
    const style = element.getAttribute("style");
    if (style === null) continue;
    for (const declaration of style.split(";")) {
      const colon = declaration.indexOf(":");
      if (colon < 0) continue;
      const property = declaration.slice(0, colon).trim().toLowerCase();
      if (property !== "" && !QT_CSS.has(property)) found.add(property);
    }
  }
  return [...found].sort();
}

/** One `style` attribute, with everything Qt cannot use taken out of it. */
export function qtStyle(style: string): string {
  return style
    .split(";")
    .map((declaration) => {
      const colon = declaration.indexOf(":");
      if (colon < 0) return null;
      const property = declaration.slice(0, colon).trim().toLowerCase();
      if (!QT_CSS.has(property)) return null;
      return `${property}:${hexColours(declaration.slice(colon + 1).trim())}`;
    })
    .filter(Boolean)
    .join(";");
}

/**
 * `rgb(65, 180, 249)` written as `#41b4f9`.
 *
 * Qt does parse `rgb()`, but hex is shorter and universally understood by
 * every version of it - and shorter matters, because the whole greeting has
 * 4096 characters and a table-based layout spends them quickly.
 */
export function hexColours(value: string): string {
  return value.replaceAll(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/g, (_match, r, g, b) => {
    const hex = (part: string) => Number(part).toString(16).padStart(2, "0");
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  });
}

/* -- The bands, as Qt lays them out --------------------------------------- */

/**
 * The palette the legacy markup paints with.
 *
 * Written into the document as hex, because there is no theme on the other
 * end: Qt draws the greeting in the chat log with whatever palette that client
 * is running, and colour that assumed a dark background would be invisible on
 * half of them. These are picked to read on both.
 */
const ACCENT = "#3399dd";
const QUIET = "#888888";
const RULE = "#555555";
const ON_ACCENT = "#ffffff";

const cell = (attributes: string, body: string) => `<td ${attributes}>${body}</td>`;
const row = (body: string) => `<tr>${body}</tr>`;
/** A full-width layout table. The only way to place anything in Qt. */
const table = (attributes: string, body: string) =>
  `<table width="100%" cellspacing="0" ${attributes}>${body}</table>`;

/**
 * A band's tone as a cell background, which is how Qt does one.
 *
 * Colour written into the document, unlike the native renderer, and that is
 * not an oversight. Qt draws this in a chat log whose palette the greeting has
 * no way to ask about; there is no tone vocabulary on that end to map onto;
 * and an operator who chose the legacy dialect chose it precisely to control
 * what those clients see. These are dark tints with light text, which is what
 * the clients being targeted are overwhelmingly run with - and it is the same
 * technique the hand-written welcome screens this exists to reproduce used.
 */
const BAND_BG: Record<string, string> = {
  accent: "#12354d",
  muted: "#22262b",
  warn: "#3d3116",
  danger: "#3d1c1c",
};

const BAND_FG: Record<string, string> = {
  accent: "#cfe8fa",
  muted: "#cccccc",
  warn: "#f2d489",
  danger: "#f3b0b0",
};

/**
 * A welcome screen as Mumble 1.5 will draw it.
 *
 * Each band becomes a row of the outer table, which is what keeps them stacked
 * and full width; a band that needs its own layout - the button, the card row,
 * a painted bar - nests a table of its own inside its cell.
 */
export function legacyMarkupOfScreen(sections: readonly Section[]): string {
  const rows = sections
    .map((section) => bandRow(section))
    .filter(Boolean)
    .join("");
  return rows === "" ? "" : table('cellpadding="0" border="0"', rows);
}

/** Where a band sits, as the attribute Qt reads. */
function at(section: Section, fallback: "left" | "center"): string {
  return `align="${section.align === "default" ? fallback : section.align}"`;
}

/**
 * A band painted with its tone.
 *
 * `bgcolor` on a cell rather than a CSS background: Qt honours the attribute
 * everywhere and the property only sometimes, and a full-width painted row is
 * the construct a title bar and a "registration is closed" notice are both
 * made of.
 */
function painted(section: Section, inner: string): string {
  if (section.tone === "none") return inner;
  const background = BAND_BG[section.tone] ?? BAND_BG.muted;
  const colour = BAND_FG[section.tone] ?? BAND_FG.muted;
  return table(
    'cellpadding="8" border="0"',
    row(cell(`bgcolor="${background}"`, `<font color="${colour}">${inner}</font>`)),
  );
}

function bandRow(section: Section): string {
  const inner = bandBody(section);
  return inner === "" ? "" : row(cell(at(section, "left"), painted(section, inner)));
}

/** One band's contents, before its tone and its alignment are applied. */
function bandBody(section: Section): string {
  switch (section.kind) {
    case "header":
      return section.title === ""
        ? ""
        : `<font color="${QUIET}" size="-1">${escapeHtml(section.title.toUpperCase())}</font>`;

    // The artwork lives in the server's livery, which these clients have no
    // way to fetch: there is no URL here they could resolve, and embedding the
    // bytes would cost more than the whole document is allowed, on every join.
    // Nothing is drawn rather than a broken image.
    case "image":
      return "";

    case "hero": {
      if (section.title === "" && section.subtitle === "") return "";
      const badge =
        section.glyph === ""
          ? ""
          : // A circle is not available - Qt has no border-radius - so the
            // badge is a square of accent colour, which is what a badge in a
            // 2003 layout was.
            table(
              'cellpadding="6" border="0"',
              row(
                cell(
                  `bgcolor="${ACCENT}" align="center"`,
                  `<font color="${ON_ACCENT}" size="+2"><b>${escapeHtml(section.glyph)}</b></font>`,
                ),
              ),
            );
      const title =
        section.title === "" ? "" : `<font size="+3"><b>${escapeHtml(section.title)}</b></font><br>`;
      const subtitle =
        section.subtitle === "" ? "" : `<font color="${QUIET}">${escapeHtml(section.subtitle)}</font>`;
      return badge + title + subtitle;
    }

    case "prose":
      return qtSafe(section.html);

    case "action": {
      if (section.title === "") return "";
      const label = `<font color="${ON_ACCENT}"><b>${escapeHtml(section.title)}</b></font>`;
      // A bordered cell with a background colour and a link in it. Qt draws
      // this as a filled block with a clickable label, which is as close to a
      // button as its rich text gets - and closer than anything else is.
      const button = isWebUrl(section.url)
        ? `<a href="${escapeHtml(section.url)}" style="text-decoration:none;color:${ON_ACCENT}">${label}</a>`
        : label;
      const filled = table(
        'cellpadding="8" border="0"',
        row(cell(`bgcolor="${section.primary ? ACCENT : "#404040"}" align="center"`, button)),
      );
      const caption =
        section.subtitle === ""
          ? ""
          : `<br><font color="${QUIET}" size="-1">${escapeHtml(section.subtitle)}</font>`;
      return filled + caption;
    }

    case "cards": {
      const shown = section.cards.filter((card) => card.label !== "");
      const heading = section.title === "" ? "" : `<b>${escapeHtml(section.title)}</b><br>`;
      if (shown.length === 0) return heading;

      // A list rather than boxes, where the operator asked for one: two links
      // under a heading are a list, and giving each the weight of a card makes
      // a screen where everything shouts.
      if (section.compact) {
        const items = shown.map((card) => `<li>${cardLink(card)}</li>`).join("");
        return `${heading}<ul>${items}</ul>`;
      }

      const width = Math.floor(100 / shown.length);
      const cells = shown
        .map((card) => {
          const eyebrow =
            card.eyebrow === ""
              ? ""
              : `<font color="${QUIET}" size="-2">${escapeHtml(card.eyebrow.toUpperCase())}</font><br>`;
          // A border on the cell rather than on a div: Qt draws borders on
          // table cells and ignores them almost everywhere else.
          return cell(
            `width="${width}%" valign="top" style="border:1px solid ${RULE};padding:8px"`,
            eyebrow + cardLink(card),
          );
        })
        .join("");
      return heading + table('cellpadding="0" border="0"', row(cells));
    }

    case "divider":
      // `<hr>` is supported, and is the one band that needs no help.
      return "<hr>";
  }
  return "";
}

/** One link, as a card or as a list item. */
function cardLink(card: Section["cards"][number]): string {
  const label = escapeHtml(card.label);
  return isWebUrl(card.url)
    ? `<a href="${escapeHtml(card.url)}" style="color:${ACCENT}"><b>${label} &rarr;</b></a>`
    : `<b>${label}</b>`;
}
