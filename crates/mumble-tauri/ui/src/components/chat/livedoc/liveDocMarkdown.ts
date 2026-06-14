/**
 * LiveDoc <-> Markdown round-trip serializer.
 *
 * Tiptap's `editor.getHTML()` output is the source of truth; we walk
 * the DOM and emit a markdown document that preserves the structural
 * formatting users actually create in the editor:
 *
 *  - Headings `h1`-`h6` (with optional `text-align`)
 *  - Paragraphs (with optional `text-align`)
 *  - Hard line breaks (`<br>` -> two-space soft break)
 *  - Bold / italic / underline / strike / highlight / inline code
 *  - Ordered + unordered lists (nested)
 *  - Blockquotes (nested)
 *  - Fenced code blocks (with language)
 *  - Horizontal rules
 *  - Links
 *  - Images (`![alt](src)` markdown for plain images; raw `<img>` HTML
 *    when sizing / styling attributes would otherwise be lost)
 *  - Inline math (`<span data-type="inlineMath" data-latex="...">`
 *    serialized as `$latex$`)
 *  - Tables emitted as GitHub-flavored pipe tables (with column
 *    alignment), falling back to raw HTML only for merged cells or block
 *    content a pipe table can't express; figures / aligned blocks stay
 *    raw HTML
 *  - Color / font / font-size / highlight-color spans emitted as raw
 *    inline HTML so they round-trip too
 *
 * The parser is the inverse: it understands the same constructs and
 * passes raw HTML through unchanged.
 */

import { escapeHtml } from "../../../utils/html";

// ---------- exporter ----------------------------------------------------

export interface MarkdownSerializeOptions {
  /** Invoked for fenced code blocks that have no explicit language; returns
   *  a detected language id (or null/"" to leave the fence bare).  The
   *  markdown view passes a highlight.js-backed detector so an auto-detect
   *  code block shows ` ```lang ` instead of a bare fence. */
  readonly detectLanguage?: (body: string) => string | null | undefined;
  /** Insert a `NUL<index>NUL` sentinel before each top-level block so a
   *  caller can locate where each block lands in the output (used to map
   *  collaborators' document positions into the markdown source).  Strip them
   *  with `stripBlockSentinels`; doing so yields the exact un-marked output. */
  readonly markBlocks?: boolean;
}

/** Detector for the code block currently being serialised, set for the
 *  duration of a single `editorHtmlToMarkdown` call (the walk is fully
 *  synchronous, so a module-scoped slot is safe and avoids threading the
 *  option through every serializer helper). */
let activeDetectLanguage: MarkdownSerializeOptions["detectLanguage"] = undefined;
/** Whether to emit top-level block sentinels for the current call. */
let activeMarkBlocks = false;

/** Serialise Tiptap HTML output to Markdown. */
export function editorHtmlToMarkdown(html: string, options: MarkdownSerializeOptions = {}): string {
  if (!html.trim()) return "";
  const dom = new DOMParser().parseFromString(
    `<!doctype html><html><body><div id="__livedoc_root">${html}</div></body></html>`,
    "text/html",
  );
  const root = dom.getElementById("__livedoc_root");
  if (!root) return "";
  activeDetectLanguage = options.detectLanguage;
  activeMarkBlocks = options.markBlocks ?? false;
  try {
    const out = serializeTopLevel(root);
    return out.replaceAll(/\n{3,}/g, "\n\n").replace(/^\n+/, "").replace(/\s+$/, "") + "\n";
  } finally {
    activeDetectLanguage = undefined;
    activeMarkBlocks = false;
  }
}

/** Zero-width sentinel marking a top-level block's start: NUL + index + NUL. */
const BLOCK_SENTINEL = String.fromCharCode(0);
const BLOCK_SENTINEL_RE = new RegExp(BLOCK_SENTINEL + "([0-9]+)" + BLOCK_SENTINEL, "g");
/**
 * Top-level block serialization.  When `markBlocks` is set, each block is
 * prefixed with a `NUL<htmlChildIndex>NUL` sentinel.  The sentinel always
 * sits at the start of a block's content (after the `\n\n` join), so stripping
 * it reproduces the exact un-marked output - see `stripBlockSentinels`.
 */
function serializeTopLevel(root: Node): string {
  const parts: string[] = [];
  const children = Array.from(root.childNodes);
  for (let i = 0; i < children.length; i++) {
    const chunk = serializeBlockNode(children[i]);
    if (!chunk) continue;
    parts.push(activeMarkBlocks ? `${BLOCK_SENTINEL}${i}${BLOCK_SENTINEL}${chunk}` : chunk);
  }
  return parts.join("\n\n");
}

/** Remove block sentinels from `markBlocks` output, returning the clean text
 *  and the offset of each block index within it. */
export function stripBlockSentinels(text: string): { text: string; blockStarts: number[] } {
  const blockStarts: number[] = [];
  let clean = "";
  let last = 0;
  let m: RegExpExecArray | null;
  BLOCK_SENTINEL_RE.lastIndex = 0;
  while ((m = BLOCK_SENTINEL_RE.exec(text)) !== null) {
    clean += text.slice(last, m.index);
    blockStarts[Number(m[1])] = clean.length;
    last = m.index + m[0].length;
  }
  clean += text.slice(last);
  return { text: clean, blockStarts };
}

function serializeBlockChildren(parent: Node): string {
  const parts: string[] = [];
  for (const child of Array.from(parent.childNodes)) {
    const chunk = serializeBlockNode(child);
    if (chunk) parts.push(chunk);
  }
  return parts.join("\n\n");
}

function serializeBlockNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const t = (node.textContent ?? "").trim();
    return t ? escapeMd(t) : "";
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  if (/^h[1-6]$/.test(tag)) {
    const level = Number(tag[1]);
    const align = readAlign(el);
    if (align || el.hasAttribute("data-dropcap")) {
      // No CommonMark syntax for alignment / drop cap - raw HTML round-trips.
      return rawBlock(el);
    }
    return `${"#".repeat(level)} ${serializeInlineChildren(el).trim()}`;
  }

  if (tag === "p") {
    const align = readAlign(el);
    if (align || el.hasAttribute("data-dropcap")) return rawBlock(el);
    const inline = serializeInlineChildren(el);
    // Empty paragraphs are real content (the user pressed Enter to create
    // visual spacing).  CommonMark collapses consecutive blank lines, so
    // we emit raw `<p></p>` which the parser passes through unchanged.
    if (!inline.trim()) return "<p></p>";
    return inline;
  }

  if (tag === "br") return "  ";

  if (tag === "hr") return "---";

  if (tag === "blockquote") {
    const inner = serializeBlockChildren(el).trim();
    if (!inner) return "> ";
    return inner
      .split("\n")
      .map((line) => (line.length ? `> ${line}` : ">"))
      .join("\n");
  }

  if (tag === "ul" && el.getAttribute("data-type") === "taskList") {
    return serializeTaskList(el);
  }

  if (tag === "ul" || tag === "ol") {
    return serializeList(el, tag === "ol");
  }

  if (tag === "pre") {
    const codeEl = el.querySelector("code");
    const langCls = codeEl?.getAttribute("class") ?? "";
    const body = (codeEl?.textContent ?? el.textContent ?? "").replace(/\n$/, "");
    let lang = /language-([a-zA-Z0-9_+-]+)/.exec(langCls)?.[1] ?? "";
    // Auto-detect blocks carry no language class; let the caller's detector
    // fill in the highlighted language so the fence reads ` ```lang `.
    if (!lang && activeDetectLanguage) lang = activeDetectLanguage(body) ?? "";
    return `\`\`\`${lang}\n${body}\n\`\`\``;
  }

  if (tag === "img") return imgToMarkdown(el) ?? el.outerHTML;

  if (tag === "table") return tableToMarkdown(el) ?? rawBlock(el);
  if (tag === "figure") return rawBlock(el);

  // Auto-numbered caption block - persist its raw markup (data-kind /
  // data-id); the visible number is regenerated live on import.
  if (tag === "figcaption" && el.hasAttribute("data-livedoc-caption")) {
    return rawBlock(el);
  }

  if (tag === "div") {
    // Manual page / section break - round-trips as its raw `<div>`.
    if (el.hasAttribute("data-page-break") || el.hasAttribute("data-section-break")) {
      return rawBlock(el);
    }
    // Auto-generated table of contents - persist the placeholder so the
    // node is recreated on import (its entries are regenerated live).
    if (el.hasAttribute("data-livedoc-toc")) {
      return rawBlock(el);
    }
    // Auto-generated endnotes section - persist the placeholder; the note
    // bodies live on the marker nodes and are regenerated live.
    if (el.hasAttribute("data-livedoc-endnotes")) {
      return rawBlock(el);
    }
    if (el.getAttribute("data-type") === "block-math") {
      const latex = decodeHtmlEntities(el.getAttribute("data-latex") ?? "");
      return `$$\n${latex}\n$$`;
    }
    // A div with alignment / role attributes round-trips as raw HTML;
    // otherwise treat as a generic block container.
    if (el.hasAttribute("style") || el.hasAttribute("align") || el.hasAttribute("class")) {
      return rawBlock(el);
    }
    return serializeBlockChildren(el);
  }

  // Unknown / inline element at block level - render inline.
  return serializeInlineChildren(el);
}

function serializeTaskList(el: Element): string {
  const lines: string[] = [];
  for (const child of Array.from(el.children)) {
    if (child.tagName.toLowerCase() !== "li") continue;
    const checked = child.getAttribute("data-checked") === "true";
    const marker = checked ? "- [x] " : "- [ ] ";
    const inlineParts: string[] = [];
    const nestedBlocks: string[] = [];
    for (const ch of Array.from(child.childNodes)) {
      if (ch.nodeType === Node.ELEMENT_NODE) {
        const t = (ch as Element).tagName.toLowerCase();
        if (t === "ul" && (ch as Element).getAttribute("data-type") === "taskList") {
          nestedBlocks.push(serializeTaskList(ch as Element));
          continue;
        }
        if (t === "ul" || t === "ol") {
          nestedBlocks.push(serializeList(ch as Element, t === "ol"));
          continue;
        }
        if (t === "p" || t === "div" || t === "label") {
          inlineParts.push(serializeInlineChildren(ch as Element));
          continue;
        }
      }
      inlineParts.push(serializeInlineNode(ch));
    }
    const head = (inlineParts.join("").trim() || "").replaceAll("\n", " ");
    lines.push(marker + head);
    for (const nested of nestedBlocks) {
      lines.push(nested.split("\n").map((l) => `  ${l}`).join("\n"));
    }
  }
  return lines.join("\n");
}

function serializeList(el: Element, ordered: boolean): string {
  const startAttr = ordered ? Number(el.getAttribute("start") ?? "1") : 0;
  let n = startAttr;
  const lines: string[] = [];
  for (const child of Array.from(el.children)) {
    if (child.tagName.toLowerCase() !== "li") continue;
    const marker = ordered ? `${n}. ` : "- ";
    n += 1;

    // Split <li> children into inline content and nested lists.
    const inlineParts: string[] = [];
    const nestedBlocks: string[] = [];
    for (const ch of Array.from(child.childNodes)) {
      if (ch.nodeType === Node.ELEMENT_NODE) {
        const t = (ch as Element).tagName.toLowerCase();
        if (t === "ul" || t === "ol") {
          nestedBlocks.push(serializeList(ch as Element, t === "ol"));
          continue;
        }
        if (t === "p") {
          // Tiptap may wrap each li in a <p>; flatten it.
          inlineParts.push(serializeInlineChildren(ch as Element));
          continue;
        }
      }
      inlineParts.push(serializeInlineNode(ch));
    }

    const head = (inlineParts.join("").trim() || "").replaceAll("\n", " ");
    lines.push(marker + head);
    for (const nested of nestedBlocks) {
      lines.push(nested.split("\n").map((l) => `  ${l}`).join("\n"));
    }
  }
  return lines.join("\n");
}

// ---------- tables / images --------------------------------------------

/** Inline tags whose content a GFM pipe-table cell can hold. Anything else
 *  (lists, nested tables, blockquotes...) forces a raw-HTML fallback. */
const INLINE_CELL_TAGS = new Set([
  "strong", "b", "em", "i", "u", "s", "del", "strike", "sub", "sup",
  "code", "br", "a", "img", "span", "mark", "font",
]);

interface SerializedCell {
  readonly text: string;
  readonly align: string | null;
  readonly header: boolean;
}

/** Gather a table's rows, descending only into `thead`/`tbody`/`tfoot` so a
 *  nested table's rows are never picked up. */
function collectTableRows(table: Element): Element[] {
  const rows: Element[] = [];
  for (const child of Array.from(table.children)) {
    const t = child.tagName.toLowerCase();
    if (t === "tr") rows.push(child);
    else if (t === "thead" || t === "tbody" || t === "tfoot") {
      for (const r of Array.from(child.children)) {
        if (r.tagName.toLowerCase() === "tr") rows.push(r);
      }
    }
  }
  return rows;
}

/** Serialise one cell to inline markdown, or null when it holds block
 *  content a pipe table can't represent (lists, nested tables...). */
function serializeCell(cell: Element): SerializedCell | null {
  let align: string | null = null;
  const parts: string[] = [];
  for (const child of Array.from(cell.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      parts.push(serializeInlineNode(child));
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const ce = child as Element;
    const t = ce.tagName.toLowerCase();
    if (t === "p" || t === "div") {
      const a = readAlign(ce);
      if (a) align = a;
      // Multiple block children collapse to one cell separated by <br>.
      if (parts.length && parts[parts.length - 1].trim()) parts.push("<br>");
      parts.push(serializeInlineChildren(ce));
    } else if (INLINE_CELL_TAGS.has(t)) {
      parts.push(serializeInlineNode(ce));
    } else {
      return null; // block content - caller falls back to raw HTML
    }
  }
  const text = parts
    .join("")
    .replace(/ {2}\n/g, "<br>") // hard breaks can't span pipe-table rows
    .replace(/\n+/g, " ")
    .replaceAll("|", "\\|")
    .trim();
  return { text, align, header: cell.tagName.toLowerCase() === "th" };
}

/** Serialise a `<table>` to a GitHub-flavored pipe table, or null when the
 *  table uses features pipe tables can't express (merged cells, block
 *  content) so the caller can keep the raw HTML. */
function tableToMarkdown(table: Element): string | null {
  const rows = collectTableRows(table);
  const matrix: SerializedCell[][] = [];
  let colCount = 0;
  for (const tr of rows) {
    const cells: SerializedCell[] = [];
    for (const cellEl of Array.from(tr.children)) {
      const tag = cellEl.tagName.toLowerCase();
      if (tag !== "td" && tag !== "th") continue;
      const colspan = Number(cellEl.getAttribute("colspan") ?? "1");
      const rowspan = Number(cellEl.getAttribute("rowspan") ?? "1");
      if (colspan > 1 || rowspan > 1) return null; // merged - keep raw HTML
      const cell = serializeCell(cellEl);
      if (!cell) return null;
      cells.push(cell);
    }
    if (cells.length) {
      colCount = Math.max(colCount, cells.length);
      matrix.push(cells);
    }
  }
  if (colCount === 0) return null;

  // Column alignment is table-wide in GFM: take the first cell in each
  // column that declares one (the header row is checked first).
  const aligns: (string | null)[] = [];
  for (let c = 0; c < colCount; c++) {
    let a: string | null = null;
    for (const row of matrix) {
      if (row[c]?.align) {
        a = row[c].align;
        break;
      }
    }
    aligns.push(a);
  }

  const renderRow = (row: SerializedCell[]): string =>
    `| ${Array.from({ length: colCount }, (_, c) => row[c]?.text ?? "").join(" | ")} |`;
  const delimCells = aligns.map((a) =>
    a === "center" ? ":-:" : a === "right" ? "--:" : a === "left" ? ":--" : "---",
  );
  const [header, ...body] = matrix;
  return [renderRow(header), `| ${delimCells.join(" | ")} |`, ...body.map(renderRow)].join("\n");
}

/** Convert a plain `<img>` (only src/alt/title, simple URL) to markdown
 *  image syntax; null when other attributes (width/height/style...) would
 *  be lost, so the caller keeps the lossless raw HTML. */
function imgToMarkdown(el: Element): string | null {
  const src = el.getAttribute("src") ?? "";
  // A bare ()-form URL can't contain whitespace or parens.
  if (!src || /[\s()]/.test(src)) return null;
  for (const attr of Array.from(el.attributes)) {
    const n = attr.name.toLowerCase();
    if (n !== "src" && n !== "alt" && n !== "title") return null;
  }
  const alt = (el.getAttribute("alt") ?? "").replaceAll("[", "\\[").replaceAll("]", "\\]");
  const title = el.getAttribute("title");
  const titlePart = title ? ` "${title.replaceAll('"', '\\"')}"` : "";
  return `![${alt}](${src}${titlePart})`;
}

function serializeInlineChildren(el: Element): string {
  let out = "";
  for (const ch of Array.from(el.childNodes)) {
    out += serializeInlineNode(ch);
  }
  return out;
}

function serializeInlineNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return escapeMd(node.textContent ?? "");
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as Element;
  const t = el.tagName.toLowerCase();
  const inner = () => serializeInlineChildren(el);

  switch (t) {
    case "strong":
    case "b":
      return wrapIfContent(inner(), "**");
    case "em":
    case "i":
      return wrapIfContent(inner(), "*");
    case "u":
      return wrapIfContent(inner(), "__");
    case "s":
    case "del":
    case "strike":
      return wrapIfContent(inner(), "~~");
    case "sub":
    case "sup": {
      // Endnote markers are inline atoms (no child text); persist their
      // raw markup so the stable id + note text survive a round-trip.
      if (el.hasAttribute("data-livedoc-endnote")) return rawInline(el, inner());
      const content = inner();
      return content ? rawInline(el, content) : "";
    }
    case "code":
      return `\`${el.textContent ?? ""}\``;
    case "br":
      return "  \n";
    case "a": {
      const href = el.getAttribute("href") ?? "";
      const text = inner() || href;
      return `[${text}](${href})`;
    }
    case "img":
      return imgToMarkdown(el) ?? el.outerHTML;
    case "span": {
      const dataType = el.getAttribute("data-type")?.toLowerCase() ?? "";
      if (dataType.includes("math")) {
        const latex = decodeHtmlEntities(el.getAttribute("data-latex") ?? "");
        return `$${latex}$`;
      }
      // Mention chips round-trip as the wire markers so chat / Live Doc
      // both speak the same format (see utils/mentions.ts).
      if (el.hasAttribute("data-mention-session")) {
        return `<@${el.getAttribute("data-mention-session") ?? ""}>`;
      }
      if (el.hasAttribute("data-mention-role")) {
        return `<@&${el.getAttribute("data-mention-role") ?? ""}>`;
      }
      if (el.hasAttribute("data-mention-everyone")) return "@everyone";
      if (el.hasAttribute("data-mention-here")) return "@here";
      // Reference nodes (bookmark anchor / cross-reference) round-trip as
      // their raw span so the stable ids survive an export/import cycle.
      if (el.hasAttribute("data-livedoc-bookmark") || el.hasAttribute("data-livedoc-xref")) {
        return rawInline(el, inner());
      }
      if (el.hasAttribute("style") || el.hasAttribute("class")) {
        return rawInline(el, inner());
      }
      return inner();
    }
    case "mark": {
      if (el.hasAttribute("style") || el.hasAttribute("class")) {
        return rawInline(el, inner());
      }
      return wrapIfContent(inner(), "==");
    }
    default:
      // Unknown inline tag - emit raw HTML to preserve attributes.
      if (el.hasAttribute("style") || el.hasAttribute("class")) {
        return rawInline(el, inner());
      }
      return inner();
  }
}

function wrapIfContent(inner: string, marker: string): string {
  return inner ? `${marker}${inner}${marker}` : "";
}

function rawBlock(el: Element): string {
  // Pretty-print on its own line so the parser treats it as a raw HTML block.
  return el.outerHTML;
}

function rawInline(el: Element, inner: string): string {
  const clone = el.cloneNode(false) as Element;
  clone.innerHTML = inner;
  return clone.outerHTML;
}

function readAlign(el: Element): string | null {
  const style = el.getAttribute("style") ?? "";
  const m = /text-align:\s*([a-zA-Z]+)/i.exec(style);
  if (!m) return null;
  const v = m[1].toLowerCase();
  return v === "left" ? null : v;
}

function escapeMd(s: string): string {
  // Escape only markers that could confuse the parser. We deliberately
  // do NOT escape `<` here - the parser stashes recognised tags first
  // and HTML-escapes the rest, so literal `<` text round-trips fine.
  return s.replaceAll(/([\\`*_[\]])/g, "\\$1");
}

function decodeHtmlEntities(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

// ---------- parser ------------------------------------------------------

export interface MarkdownParseOptions {
  /** Resolve a user mention's session id to a display name, so `<@123>`
   *  becomes a chip labelled `@RealName` instead of the `@user-123`
   *  placeholder.  Returns undefined for unknown sessions. */
  readonly resolveMention?: (session: number) => string | undefined;
}

/** Resolver for the parse currently running (set for the duration of one
 *  synchronous `markdownToEditorHtml` call). */
let activeResolveMention: MarkdownParseOptions["resolveMention"] = undefined;

/** Convert markdown back to HTML suitable for `editor.commands.setContent`. */
export function markdownToEditorHtml(markdown: string, options: MarkdownParseOptions = {}): string {
  if (!markdown.trim()) return "";
  activeResolveMention = options.resolveMention;
  try {
    return parseBlocks(markdown.replaceAll(/\r\n?/g, "\n").split("\n"));
  } finally {
    activeResolveMention = undefined;
  }
}

const RAW_BLOCK_TAGS = new Set([
  "h1", "h2", "h3", "h4", "h5", "h6",
  "p", "div", "table", "figure", "figcaption", "blockquote",
  "ul", "ol", "pre", "hr", "img",
]);

function parseBlocks(lines: string[]): string {
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Blank line - paragraph separator.
    if (!line.trim()) {
      i++;
      continue;
    }

    // Raw HTML block: line starts with `<tag` where tag is a known block tag.
    const tagMatch = /^<([a-zA-Z][a-zA-Z0-9]*)\b/.exec(line);
    if (tagMatch && RAW_BLOCK_TAGS.has(tagMatch[1].toLowerCase())) {
      const consumed = collectRawHtmlBlock(lines, i, tagMatch[1].toLowerCase());
      out.push(lines.slice(i, i + consumed).join("\n"));
      i += consumed;
      continue;
    }

    // ATX heading: `#`-`######` followed by space.
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      out.push(`<h${level}>${parseInline(h[2].trim())}</h${level}>`);
      i++;
      continue;
    }

    // Display math block: $$\n...\n$$
    if (line === "$$") {
      const body: string[] = [];
      i++;
      while (i < lines.length && lines[i] !== "$$") {
        body.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // skip closing $$
      const latex = body.join("\n").trim().replaceAll('"', "&quot;");
      out.push(`<div data-type="block-math" data-latex="${latex}"></div>`);
      continue;
    }

    // Fenced code block.
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        body.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // skip closing ```
      const cls = lang ? ` class="language-${lang}"` : "";
      out.push(`<pre><code${cls}>${escapeHtml(body.join("\n"))}</code></pre>`);
      continue;
    }

    // Horizontal rule.
    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }

    // Blockquote (one or more leading `>`).
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      out.push(`<blockquote>${parseBlocks(buf)}</blockquote>`);
      continue;
    }

    // List (ordered or unordered, possibly nested via indentation).
    if (/^(\s*)([-*+]|\d+[.)])\s+/.test(line)) {
      const { html, consumed } = parseListBlock(lines, i);
      out.push(html);
      i += consumed;
      continue;
    }

    // GFM pipe table: a row of cells followed by a delimiter row.
    if (startsTable(lines, i)) {
      const { html, consumed } = parseTableBlock(lines, i);
      out.push(html);
      i += consumed;
      continue;
    }

    // Paragraph: collect contiguous non-blank lines that don't open
    // another block-level construct.
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i]) && !startsTable(lines, i)) {
      buf.push(lines[i]);
      i++;
    }
    const joined = buf
      .map((l, idx) => (idx < buf.length - 1 && l.endsWith("  ") ? `${l.slice(0, -2)}<br>` : l))
      .join("\n");
    out.push(`<p>${parseInline(joined)}</p>`);
  }
  return out.join("");
}

function isBlockStart(line: string): boolean {
  if (/^(#{1,6})\s/.test(line)) return true;
  if (line === "$$") return true;
  if (line.startsWith("```")) return true;
  if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) return true;
  if (/^>\s?/.test(line)) return true;
  if (/^(\s*)([-*+]|\d+[.)])\s+/.test(line)) return true;
  const tag = /^<([a-zA-Z][a-zA-Z0-9]*)\b/.exec(line);
  return !!(tag && RAW_BLOCK_TAGS.has(tag[1].toLowerCase()));
}

/**
 * Collect lines belonging to a raw HTML block starting at `start`.
 * Self-closing tags (`<hr>`, `<img>`) span a single line.  Other tags
 * are collected until the matching closing tag appears, or until a
 * blank line (whichever comes first).
 */
function collectRawHtmlBlock(lines: string[], start: number, tag: string): number {
  if (tag === "hr" || tag === "img") return 1;
  const closeRe = new RegExp(`</${tag}\\s*>`, "i");
  let i = start;
  let depth = 0;
  while (i < lines.length) {
    const line = lines[i];
    const opens = (line.match(new RegExp(`<${tag}\\b`, "gi")) ?? []).length;
    const closes = (line.match(closeRe) ?? []).length;
    depth += opens - closes;
    i++;
    if (depth <= 0 && i > start) return i - start;
    if (!line.trim() && i > start + 1) return i - start - 1;
  }
  return i - start;
}

const TASK_PREFIX_RE = /^\[([ xX])\]\s+/;

function parseListBlock(lines: string[], start: number): { html: string; consumed: number } {
  const firstMatch = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[start])!;
  const baseIndent = firstMatch[1].length;
  const ordered = /\d/.test(firstMatch[2]);
  const isTaskList = !ordered && TASK_PREFIX_RE.test(firstMatch[3]);
  const items: {
    content: string[];
    nested: { html: string; consumed: number } | null;
    checked: boolean | null;
  }[] = [];
  let i = start;
  while (i < lines.length) {
    const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
    if (!m) break;
    const indent = m[1].length;
    if (indent < baseIndent) break;
    if (indent > baseIndent) {
      const nested = parseListBlock(lines, i);
      if (items.length) items[items.length - 1].nested = nested;
      i += nested.consumed;
      continue;
    }
    let body = m[3];
    let checked: boolean | null = null;
    if (isTaskList) {
      const tm = TASK_PREFIX_RE.exec(body);
      if (tm) {
        checked = tm[1].toLowerCase() === "x";
        body = body.slice(tm[0].length);
      }
    }
    items.push({ content: [body], nested: null, checked });
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(\s*)([-*+]|\d+[.)])\s+/.test(lines[i]) &&
      lines[i].startsWith(" ".repeat(baseIndent + 2))
    ) {
      items[items.length - 1].content.push(lines[i].slice(baseIndent + 2));
      i++;
    }
  }

  if (isTaskList) {
    const renderedItems = items
      .map((it) => {
        const inline = parseInline(it.content.join("\n"));
        const nested = it.nested ? it.nested.html : "";
        const checkedAttr = it.checked ? ' data-checked="true"' : ' data-checked="false"';
        return `<li data-type="taskItem"${checkedAttr}><p>${inline}</p>${nested}</li>`;
      })
      .join("");
    return {
      html: `<ul data-type="taskList">${renderedItems}</ul>`,
      consumed: i - start,
    };
  }

  const tag = ordered ? "ol" : "ul";
  const renderedItems = items
    .map((it) => {
      const inline = parseInline(it.content.join("\n"));
      const nested = it.nested ? it.nested.html : "";
      return `<li>${inline}${nested}</li>`;
    })
    .join("");
  return { html: `<${tag}>${renderedItems}</${tag}>`, consumed: i - start };
}

// ---------- tables ------------------------------------------------------

/** Split a pipe-table row into trimmed cells, honoring `\|` escapes and an
 *  optional leading/trailing pipe. */
function splitTableRow(line: string): string[] {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|") && !t.endsWith("\\|")) t = t.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let k = 0; k < t.length; k++) {
    const ch = t[k];
    if (ch === "\\" && t[k + 1] === "|") {
      cur += "|";
      k++;
      continue;
    }
    if (ch === "|") {
      cells.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

/** A delimiter row is all `:?-+:?` cells (e.g. `| --- | :-: | --: |`). */
function isTableDelimiterRow(line: string): boolean {
  if (!line.includes("-")) return false;
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
}

/** Column alignment from a delimiter cell (`:--` left, `:-:` center, `--:`
 *  right, `---` none). */
function parseTableAlign(cell: string): string | null {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return null;
}

/** True when line `i` opens a GFM pipe table (a cell row immediately
 *  followed by a delimiter row). */
function startsTable(lines: string[], i: number): boolean {
  return lines[i].includes("|") && i + 1 < lines.length && isTableDelimiterRow(lines[i + 1]);
}

function parseTableBlock(lines: string[], start: number): { html: string; consumed: number } {
  const header = splitTableRow(lines[start]);
  const aligns = splitTableRow(lines[start + 1]).map(parseTableAlign);
  let i = start + 2;
  const body: string[][] = [];
  while (i < lines.length && lines[i].trim() && lines[i].includes("|") && !isBlockStart(lines[i])) {
    body.push(splitTableRow(lines[i]));
    i++;
  }
  const colCount = Math.max(header.length, ...body.map((r) => r.length));
  const cell = (text: string, align: string | null, isHeader: boolean): string => {
    const tag = isHeader ? "th" : "td";
    // Alignment rides on the inner paragraph so the TextAlign extension
    // (configured for paragraphs) round-trips it.
    const style = align && align !== "left" ? ` style="text-align: ${align}"` : "";
    return `<${tag}><p${style}>${parseInline(text)}</p></${tag}>`;
  };
  const row = (cells: string[], isHeader: boolean): string =>
    `<tr>${Array.from({ length: colCount }, (_, c) =>
      cell(cells[c] ?? "", aligns[c] ?? null, isHeader),
    ).join("")}</tr>`;
  const headerRow = row(header, true);
  const bodyRows = body.map((r) => row(r, false)).join("");
  return { html: `<table><tbody>${headerRow}${bodyRows}</tbody></table>`, consumed: i - start };
}

// ---------- inline ------------------------------------------------------

/**
 * Convert a single line / paragraph of markdown text to HTML.
 *
 * Raw HTML tags (anything matching `<tag…>` or `</tag>`) are stashed
 * before escaping so they pass through unchanged - this is what makes
 * `<img>` data-URLs, `<span style="color:#…">`, and `<mark>` round-trip.
 */
function parseInline(text: string): string {
  const stash: string[] = [];
  const push = (html: string): string => {
    stash.push(html);
    return `\u0000H${stash.length - 1}\u0000`;
  };

  // Mention markers: stash before the generic HTML stash so they
  // survive HTML escaping and aren't mistaken for raw tags.  Matches
  // the wire format used by chat messages (see utils/mentions.ts).
  let s = text.replaceAll(/<@(\d+)>/g, (_m, sid: string) => {
    const name = activeResolveMention?.(Number(sid)) ?? `user-${sid}`;
    const safe = name.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    return push(
      `<span class="mention mention-user" data-mention-session="${sid}">@${safe}</span>`,
    );
  });
  s = s.replaceAll(/<@&([^>\s]+)>/g, (_m, name: string) => {
    const safe = name.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
    return push(
      `<span class="mention mention-role" data-mention-role="${safe}">@${safe}</span>`,
    );
  });
  s = s.replaceAll(/(^|\s)@everyone\b/g, (_m, lead: string) =>
    `${lead}${push(
      `<span class="mention mention-everyone" data-mention-everyone="1">@everyone</span>`,
    )}`,
  );
  s = s.replaceAll(/(^|\s)@here\b/g, (_m, lead: string) =>
    `${lead}${push(
      `<span class="mention mention-here" data-mention-here="1">@here</span>`,
    )}`,
  );

  // Stash tags that look like real HTML. We accept self-closing,
  // opening, and closing forms with any attribute payload.
  s = s.replaceAll(/<\/?[a-zA-Z][a-zA-Z0-9]*\b[^<>]*\/?>/g, (m) => push(m));

  // Escape leftover HTML entities so literal `<`/`&` survive.
  s = s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

  // Inline code first - its content is taken verbatim.
  s = s.replaceAll(/`([^`\n]+)`/g, "<code>$1</code>");

  // Inline math: $latex$
  s = s.replaceAll(/\$([^$\n]+)\$/g, (_m, latex: string) => {
    const safe = latex.replaceAll('"', "&quot;");
    return `<span data-type="inlineMath" data-latex="${safe}"></span>`;
  });

  // Markdown image must run before link so `![…](…)` doesn't get
  // partially eaten by the link regex.
  s = s.replaceAll(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_m, alt: string, url: string, title?: string) => {
    const a = ` alt="${alt.replaceAll('"', "&quot;")}"`;
    const u = ` src="${url.replaceAll('"', "&quot;")}"`;
    const ti = title ? ` title="${title.replaceAll('"', "&quot;")}"` : "";
    return `<img${u}${a}${ti}>`;
  });

  // Links: [text](url)
  s = s.replaceAll(/\[([^\]\n]+)]\(([^)\s]+)\)/g, (_m, t: string, u: string) => {
    const safe = u.replaceAll('"', "&quot;");
    return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${t}</a>`;
  });

  // Bold, italic, underline, strike, highlight.
  s = s.replaceAll(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  s = s.replaceAll(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, "$1<em>$2</em>");
  s = s.replaceAll(/__([^_\n]+)__/g, "<u>$1</u>");
  s = s.replaceAll(/~~([^~\n]+)~~/g, "<s>$1</s>");
  s = s.replaceAll(/==([^=\n]+)==/g, "<mark>$1</mark>");

  // Unescape user-written backslash escapes (`\*` -> `*`).
  s = s.replaceAll(/\\([\\`*_[\]])/g, "$1");

  // Restore stashed raw HTML.
  s = s.replaceAll(/\u0000H(\d+)\u0000/g, (_m, idx: string) => stash[Number(idx)] ?? "");
  return s;
}

