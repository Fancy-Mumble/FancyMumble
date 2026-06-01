/**
 * exportLiveDocToPdf - print the editor HTML into a hidden iframe and
 * trigger its `window.print()` dialog so the user can pick "Save as
 * PDF" (or send to a real printer).  Uses the browser/webview print
 * dialog rather than a JS PDF library so we don't ship an extra
 * megabyte of dependencies for a feature most users invoke rarely.
 *
 * Returns a Promise that resolves once the iframe has been removed
 * from the DOM, or rejects if the iframe document can't be opened.
 */

import {
  pageCssRule,
  DEFAULT_PAGE_SETUP,
  DEFAULT_DECORATION,
  BORDER_WIDTH_PX,
  type LiveDocPageSetup,
  type LiveDocDecoration,
} from "./useLiveDoc";

const PRINT_STYLES = `
  body { font-family: system-ui, -apple-system, Inter, sans-serif; color: #111; line-height: 1.6; font-size: 12pt; margin: 0; }
  h1 { font-size: 1.8em; margin: 0.6em 0 0.3em; }
  h2 { font-size: 1.4em; margin: 0.6em 0 0.3em; }
  h3 { font-size: 1.2em; margin: 0.6em 0 0.3em; }
  p { margin: 0.4em 0; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; table-layout: fixed; }
  th, td { border: 1px solid #888; padding: 6px 10px; vertical-align: top; }
  th { background: #f0f0f0; font-weight: 600; }
  blockquote { border-left: 3px solid #2aabee; padding-left: 12px; color: #555; margin: 0.6em 0; }
  pre { background: #f5f5f5; padding: 10px; border-radius: 4px; overflow-x: auto; font-family: ui-monospace, Menlo, monospace; font-size: 11pt; }
  code { background: #f5f5f5; padding: 1px 4px; border-radius: 3px; font-family: ui-monospace, Menlo, monospace; font-size: 0.9em; }
  img { max-width: 100%; height: auto; }
  a { color: #1a4dbe; text-decoration: underline; }
  ul, ol { padding-left: 24px; }
  .collaboration-cursor__caret, .collaboration-cursor__label { display: none !important; }
  /* Manual page / section breaks force a real page break, no visible mark. */
  .livedoc-page-break, .livedoc-section-break { break-after: page; page-break-after: always; height: 0; border: 0; margin: 0; }
  .livedoc-page-break::after, .livedoc-section-break::after { display: none !important; }
  /* Diagonal watermark behind the content. */
  .livedoc-print-watermark {
    position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
    z-index: -1; pointer-events: none;
  }
  .livedoc-print-watermark span {
    transform: rotate(-32deg); font-size: 120px; font-weight: 800; text-transform: uppercase;
    letter-spacing: 0.08em; color: #000; opacity: 0.08; white-space: nowrap;
  }
  /* Page border drawn inside the printed margin box. */
  .livedoc-print-border { position: fixed; inset: 0; border-style: solid; border-color: #333; pointer-events: none; }
`;

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function exportLiveDocToPdf(
  html: string,
  title: string,
  pageSetup: LiveDocPageSetup = DEFAULT_PAGE_SETUP,
  decoration: LiveDocDecoration = DEFAULT_DECORATION,
): Promise<void> {
  const { size, margin } = pageCssRule(pageSetup);
  const pageRule = `@page { size: ${size}; margin: ${margin}; }`;
  // Decoration overlays are injected ahead of the content so they sit
  // behind it (watermark) or frame it (border).  Best-effort in the
  // browser print path - exact per-page repetition needs a paginator.
  const watermark = decoration.watermark.trim()
    ? `<div class="livedoc-print-watermark"><span>${escapeHtml(decoration.watermark)}</span></div>`
    : "";
  const border =
    decoration.border !== "none"
      ? `<div class="livedoc-print-border" style="border-width:${BORDER_WIDTH_PX[decoration.border]}px"></div>`
      : "";
  return new Promise((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    document.body.appendChild(iframe);

    const cleanup = () => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    };

    const doc = iframe.contentDocument;
    const win = iframe.contentWindow;
    if (!doc || !win) {
      cleanup();
      reject(new Error("Could not access print iframe document"));
      return;
    }

    const docHtml =
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
      `<style>${pageRule}\n${PRINT_STYLES}</style></head><body>${watermark}${border}${html}</body></html>`;

    doc.open();
    doc.write(docHtml);
    doc.close();

    // doc.write() is fire-and-forget; wait until layout + image loads
    // have settled before triggering the print dialog.  Two rAFs is the
    // common "next paint after current paint" idiom.
    const triggerPrint = () => {
      try {
        win.focus();
        win.print();
      } catch (err) {
        cleanup();
        reject(err);
        return;
      }
      // The print dialog is blocking on most platforms; once it returns
      // (user confirmed or cancelled) we tear the iframe down on the
      // next tick.
      setTimeout(() => {
        cleanup();
        resolve();
      }, 0);
    };

    requestAnimationFrame(() => requestAnimationFrame(triggerPrint));
  });
}
