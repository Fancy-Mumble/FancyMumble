/**
 * The formatted text on a card.
 *
 * A bio arrives as HTML - it is written in a WYSIWYG editor and carried in the
 * Mumble comment, where any client may have put anything - so the card has to
 * render markup it does not trust. It does that without a sanitiser and without
 * `dangerouslySetInnerHTML`: the markup is parsed into the small tree below and
 * that tree is turned into React elements, so a tag becomes an element only by
 * being named in `TAGS` and an attribute becomes a prop only by being read out
 * by name and validated here. Anything else never reaches the DOM - not as an
 * ignored attribute, not as a stripped tag, not at all.
 *
 * The alternative was DOMPurify, which the client has and the channel viewer
 * does not; a card that needed it would be a card only one of the two hosts
 * could mount. This costs the card nothing it was not already paying: a
 * paragraph of allow-listed React.
 */
import type { CSSProperties, ReactNode } from "react";

/** What a mark may turn into. Everything else is unwrapped or dropped. */
const TAGS = {
  p: "p",
  div: "p",
  strong: "strong",
  b: "strong",
  em: "em",
  i: "em",
  u: "u",
  s: "s",
  strike: "s",
  del: "s",
  code: "code",
  span: "span",
  font: "span",
  a: "a",
} as const;

/** Markup whose *content* is not text either - dropped whole, not unwrapped. */
const DROP = new Set(["script", "style", "head", "title", "template", "iframe", "object", "embed"]);

export type RichTag = (typeof TAGS)[keyof typeof TAGS];

export type RichNode =
  | { kind: "text"; text: string }
  | { kind: "break" }
  | { kind: "image"; src: string; alt: string }
  | { kind: "element"; tag: RichTag; color?: string; href?: string; children: RichNode[] };

/** Images are inlined into the comment, so an external `src` is never ours. */
const DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i;

/** A link may leave the app, so it may only be a web address. */
const WEB_URL = /^https?:\/\/[^\s"'<>]+$/i;

/**
 * A colour, and nothing that merely contains one.
 *
 * The editor writes `color:#ff4d4d`, older clients write `<font color="red">`,
 * and a hand-written comment may carry anything at all. Matching the whole
 * value rather than searching it is what keeps `url(...)` and a second
 * declaration smuggled in behind a semicolon from ever being a colour.
 */
const COLOR = /^(#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([0-9.,%\s/deg-]+\)|[a-z]{3,20})$/i;

function colorOf(element: Element): string | undefined {
  const declared =
    /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(element.getAttribute("style") ?? "")?.[1] ??
    element.getAttribute("color");
  const value = declared?.trim();
  return value && COLOR.test(value) ? value : undefined;
}

/**
 * Parsed text, most recently used last.
 *
 * The card re-renders for reasons that have nothing to do with its text - a
 * volume slider being dragged is one render per pointer tick - and parsing the
 * same bio again each time is a whole HTML document per tick. Small, because
 * what is worth keeping is the handful of cards actually on screen; the same
 * shape `parseComment` uses next door, for the same reason.
 */
const CACHE_MAX = 64;
const cache = new Map<string, RichNode[]>();

/**
 * Parse formatted text into the tree the card draws.
 *
 * Split out from the rendering so what survives untrusted markup is a question
 * with an answer, testable without mounting anything.
 */
export function parseRichText(html: string, inline = false): RichNode[] {
  if (!html) return [];
  if (typeof DOMParser === "undefined") return [{ kind: "text", text: html }];
  const key = `${inline ? "1" : "0"}${html}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const parsed = collect(new DOMParser().parseFromString(html, "text/html").body, inline);
  cache.set(key, parsed);
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return parsed;
}

function collect(parent: Node, inline: boolean): RichNode[] {
  const out: RichNode[] = [];
  for (const node of parent.childNodes) out.push(...convert(node, inline));
  return out;
}

function convert(node: Node, inline: boolean): RichNode[] {
  if (node.nodeType === 3) {
    const text = node.nodeValue ?? "";
    return text ? [{ kind: "text", text }] : [];
  }
  if (node.nodeType !== 1) return [];
  const element = node as Element;
  const name = element.tagName.toLowerCase();
  if (DROP.has(name)) return [];
  if (name === "br") return inline ? [{ kind: "text", text: " " }] : [{ kind: "break" }];

  if (name === "img") {
    const src = element.getAttribute("src") ?? "";
    // A status is one line beside a name; an image would not be one.
    if (inline || !DATA_IMAGE.test(src)) return [];
    return [{ kind: "image", src, alt: element.getAttribute("alt") ?? "" }];
  }

  const children = collect(element, inline);
  const tag = TAGS[name as keyof typeof TAGS];
  // Anything unrecognised keeps its text and loses its box - a table's cells
  // are still someone's words, and dropping them would lose the bio entirely.
  if (!tag) return children;
  if (children.length === 0) return [];

  if (tag === "a") {
    const href = element.getAttribute("href")?.trim() ?? "";
    if (!WEB_URL.test(href)) return children;
    return [{ kind: "element", tag, href, children }];
  }

  // A paragraph inside a status would break the row it sits on.
  if (tag === "p" && inline) return children;
  return [{ kind: "element", tag, color: colorOf(element), children }];
}

/** The words alone: a sidebar preview, a title attribute, a search index. */
export function richTextToPlain(html: string): string {
  return plain(parseRichText(html)).replace(/\s+/g, " ").trim();
}

function plain(nodes: readonly RichNode[]): string {
  return nodes
    .map((node) => {
      if (node.kind === "text") return node.text;
      if (node.kind === "break") return " ";
      if (node.kind === "image") return "";
      return plain(node.children) + (node.tag === "p" ? " " : "");
    })
    .join("");
}

/** Whether there is anything to draw - `<p></p>` is what an emptied editor writes. */
export function isRichTextEmpty(html: string): boolean {
  if (!html.trim()) return true;
  const nodes = parseRichText(html);
  return !nodes.some(hasContent);
}

function hasContent(node: RichNode): boolean {
  if (node.kind === "text") return node.text.trim().length > 0;
  if (node.kind === "image") return true;
  if (node.kind === "break") return false;
  return node.children.some(hasContent);
}

export interface RichTextProps {
  /** Formatted text, from wherever - it is treated as hostile either way. */
  html: string;
  /**
   * One line: paragraphs are flattened and images dropped, for the places a
   * block would break the row it sits on.
   */
  inline?: boolean;
  /** Colour a link is drawn in; links are left unstyled without it. */
  linkColor?: string;
  style?: CSSProperties;
  className?: string;
}

/**
 * Formatted text, rendered as elements rather than as markup.
 *
 * The container is a `span` inline and a `div` otherwise, so the caller styles
 * one box - margins, size, the hover card's line clamp - and the marks inside
 * inherit from it exactly as plain text used to.
 */
export function RichText({ html, inline, linkColor, style, className }: Readonly<RichTextProps>) {
  const nodes = parseRichText(html, inline);
  const Container = inline ? "span" : "div";
  return (
    <Container className={className} style={style}>
      {render(nodes, linkColor)}
    </Container>
  );
}

function render(nodes: readonly RichNode[], linkColor: string | undefined): ReactNode {
  return nodes.map((node, index) => {
    const key = index;
    if (node.kind === "text") return node.text;
    if (node.kind === "break") return <br key={key} />;
    if (node.kind === "image")
      return (
        <img
          key={key}
          src={node.src}
          alt={node.alt}
          style={{ maxWidth: "100%", height: "auto", borderRadius: 8, display: "block", margin: "4px auto" }}
        />
      );

    const children = render(node.children, linkColor);
    const color = node.color ? { color: node.color } : undefined;
    if (node.tag === "a")
      return (
        <a
          key={key}
          href={node.href}
          target="_blank"
          // A card is rendered inside someone else's window; `noopener` is what
          // keeps the page it opens from reaching back into this one.
          rel="noopener noreferrer nofollow"
          style={{ color: linkColor, textDecoration: "underline", ...color }}
        >
          {children}
        </a>
      );
    if (node.tag === "p")
      // Spaced from the paragraph above rather than around itself, so a bio
      // reads as paragraphs without opening a gap above its own first line -
      // the caller's box already set the margin that belongs there.
      return (
        <p key={key} style={{ margin: 0, marginTop: index === 0 ? 0 : "0.5em", ...color }}>
          {children}
        </p>
      );
    if (node.tag === "code")
      return (
        <code key={key} style={{ fontSize: "0.92em", ...color }}>
          {children}
        </code>
      );
    const Mark = node.tag;
    return (
      <Mark key={key} style={color}>
        {children}
      </Mark>
    );
  });
}
