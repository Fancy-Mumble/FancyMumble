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
 *  - Images (raw `<img>` HTML, so base64 data-URLs and width / height
 *    attributes survive)
 *  - Inline math (`<span data-type="inlineMath" data-latex="...">`
 *    serialized as `$latex$`)
 *  - Tables / figures / aligned blocks emitted as raw HTML
 *  - Color / font / font-size / highlight-color spans emitted as raw
 *    inline HTML so they round-trip too
 *
 * The parser is the inverse: it understands the same constructs and
 * passes raw HTML through unchanged.
 */

// ---------- exporter ----------------------------------------------------

/** Serialise Tiptap HTML output to Markdown. */
export function editorHtmlToMarkdown(html: string): string {
  if (!html.trim()) return "";
  const dom = new DOMParser().parseFromString(
    `<!doctype html><html><body><div id="__livedoc_root">${html}</div></body></html>`,
    "text/html",
  );
  const root = dom.getElementById("__livedoc_root");
  if (!root) return "";
  const out = serializeBlockChildren(root);
  return out.replaceAll(/\n{3,}/g, "\n\n").replace(/^\n+/, "").replace(/\s+$/, "") + "\n";
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
    if (align) {
      // No CommonMark syntax for alignment on headings - raw HTML round-trips.
      return rawBlock(el);
    }
    return `${"#".repeat(level)} ${serializeInlineChildren(el).trim()}`;
  }

  if (tag === "p") {
    const align = readAlign(el);
    if (align) return rawBlock(el);
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
    const lang = /language-([a-zA-Z0-9_+-]+)/.exec(langCls)?.[1] ?? "";
    const body = (codeEl?.textContent ?? el.textContent ?? "").replace(/\n$/, "");
    return `\`\`\`${lang}\n${body}\n\`\`\``;
  }

  if (tag === "img") return el.outerHTML;

  if (tag === "table" || tag === "figure") return rawBlock(el);

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
      return el.outerHTML;
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

/** Convert markdown back to HTML suitable for `editor.commands.setContent`. */
export function markdownToEditorHtml(markdown: string): string {
  if (!markdown.trim()) return "";
  return parseBlocks(markdown.replaceAll(/\r\n?/g, "\n").split("\n"));
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

    // Paragraph: collect contiguous non-blank lines that don't open
    // another block-level construct.
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) {
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
  let s = text.replaceAll(/<@(\d+)>/g, (_m, sid: string) =>
    push(
      `<span class="mention mention-user" data-mention-session="${sid}">@user-${sid}</span>`,
    ),
  );
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

function escapeHtml(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
