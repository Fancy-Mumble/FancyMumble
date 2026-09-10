import { useMemo } from "react";

/**
 * A `dangerouslySetInnerHTML` value that keeps its identity between renders.
 *
 * React compares that prop by reference rather than by the string inside it,
 * so a fresh `{ __html }` literal - which is what writing it inline produces on
 * every render - makes it re-assign `innerHTML` even when the markup has not
 * changed by a character. Re-assigning it throws the element's text nodes away
 * and builds new ones, and the browser drops any selection standing in them.
 *
 * In the chat river that was the whole of "I cannot copy anything": a row
 * re-renders when the pointer so much as crosses it (the hover strip is state),
 * and the reader's half-selected paragraph went with the rebuilt text. Handing
 * React the same object back leaves the markup - and the selection - alone.
 */
export function useInnerHtml(html: string): { __html: string } {
  return useMemo(() => ({ __html: html }), [html]);
}
