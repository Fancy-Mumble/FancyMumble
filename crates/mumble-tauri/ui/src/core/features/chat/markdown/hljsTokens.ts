/**
 * hljsTokens - flatten a highlight.js HTML fragment into a flat list of
 * `{ text, cls }` leaves, inheriting the nearest ancestor's class name.
 *
 * Shared by the chat `MarkdownInput` and the Live Doc markdown view so both
 * can render syntax-highlighted text as React nodes (rather than raw HTML),
 * which is what lets them splice a custom caret / selection / mention chips
 * into the coloured stream.
 */

export interface HljsToken {
  readonly text: string;
  readonly cls: string;
}

/**
 * Walk an hljs-produced HTML fragment and return flat `{ text, cls }`
 * tokens.  The concatenated `text` of all tokens equals the original
 * (decoded) source, so character offsets line up with the raw string.
 */
export function flattenHljs(html: string): HljsToken[] {
  const container = document.createElement("div");
  container.innerHTML = html;
  const tokens: HljsToken[] = [];

  function visit(node: Node, cls: string): void {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent ?? "";
      if (t) tokens.push({ text: t, cls });
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const childCls = el.className || cls;
      for (const child of el.childNodes) visit(child, childCls);
    }
  }

  for (const child of container.childNodes) visit(child, "");
  return tokens;
}
