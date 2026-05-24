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

const PRINT_STYLES = `
  @page { size: A4; margin: 20mm; }
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
`;

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function exportLiveDocToPdf(html: string, title: string): Promise<void> {
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
      `<style>${PRINT_STYLES}</style></head><body>${html}</body></html>`;

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
