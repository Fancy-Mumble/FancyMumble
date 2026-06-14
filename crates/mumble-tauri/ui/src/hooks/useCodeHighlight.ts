import { useEffect } from "react";
import { loadHljs, loadedHljs } from "../components/chat/markdown/lazyHljs";

const HIGHLIGHTED = "data-hljs-highlighted";

function isInsideEditor(el: Element): boolean {
  return el.closest("[contenteditable]") !== null;
}

function highlightAllPending(root: ParentNode): void {
  const blocks = root.querySelectorAll<HTMLElement>(
    `pre > code:not([${HIGHLIGHTED}])`,
  );
  if (blocks.length === 0) return; // common case: no highlighter load at all
  const hljs = loadedHljs();
  if (!hljs) {
    // First code block seen: load highlight.js, then re-scan the whole document
    // so every pending block (not just this root) gets coloured.
    void loadHljs().then(() => highlightAllPending(document));
    return;
  }
  blocks.forEach((block) => {
    if (isInsideEditor(block)) return;
    block.setAttribute(HIGHLIGHTED, "true");
    try {
      hljs.highlightElement(block);
    } catch {
      // hljs throws on already-highlighted elements; ignore.
    }
  });
}

/**
 * Globally watches the document for `<pre><code>` blocks and applies
 * highlight.js syntax highlighting on a single pass per element.
 *
 * Mounted once at the app root so chat messages, channel descriptions,
 * server welcome text and bios all benefit without each renderer
 * needing to wire its own highlight pass.
 */
export function useCodeHighlight(): void {
  useEffect(() => {
    highlightAllPending(document);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of Array.from(mutation.addedNodes)) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            highlightAllPending(node as Element);
          }
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
}
