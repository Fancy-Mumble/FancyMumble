/**
 * useLiveDocPageCount - non-destructive page-count estimate.
 *
 * Measures the rendered top-level blocks of the editor and runs the pure
 * `paginate` planner to estimate how many pages the content occupies.
 * It never mutates the document or the DOM - it only reports a number for
 * a status indicator.  Updates are deduped via a content signature so the
 * editor cannot enter a measure-render-measure loop.
 */

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import {
  measureBlocks,
  paginate,
  paginationSignature,
} from "./liveDocPagination";

/** Safely read the editor's content DOM.  TipTap's `editor.view` getter
 *  throws while the view is still mounting, so callers that run during a
 *  passive effect must tolerate that and retry on the `create` event. */
function editorDom(editor: Editor): HTMLElement | null {
  if (editor.isDestroyed) return null;
  try {
    return editor.view?.dom ?? null;
  } catch {
    return null;
  }
}

export function useLiveDocPageCount(
  editor: Editor | null,
  pageContentHeight: number,
): number {
  const [pageCount, setPageCount] = useState(1);
  const signatureRef = useRef("");

  useEffect(() => {
    if (!editor) {
      setPageCount(1);
      signatureRef.current = "";
      return;
    }

    let observer: ResizeObserver | null = null;

    const recompute = () => {
      const dom = editorDom(editor);
      if (!dom) return;
      const blocks = measureBlocks(dom);
      const signature = paginationSignature(blocks, pageContentHeight);
      if (signature === signatureRef.current) return;
      signatureRef.current = signature;
      setPageCount(paginate(blocks, pageContentHeight).pageCount);
    };

    const attachObserver = () => {
      const dom = editorDom(editor);
      if (!dom || observer) return;
      observer = new ResizeObserver(recompute);
      observer.observe(dom);
    };

    recompute();
    attachObserver();
    editor.on("create", recompute);
    editor.on("create", attachObserver);
    editor.on("update", recompute);

    return () => {
      editor.off("create", recompute);
      editor.off("create", attachObserver);
      editor.off("update", recompute);
      observer?.disconnect();
    };
  }, [editor, pageContentHeight]);

  return pageCount;
}
