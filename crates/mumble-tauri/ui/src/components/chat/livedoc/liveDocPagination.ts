/**
 * liveDocPagination - pure pagination *measurement* foundation.
 *
 * This module deliberately contains no DOM or React: given the measured
 * pixel heights of the document's top-level blocks and the usable height
 * of one page, it splits the blocks into page-sized groups, honours
 * forced page/section breaks, and reports how many pages the content
 * would occupy.
 *
 * It is the groundwork for a future live-reflow engine (roadmap item 5)
 * but does NOT itself move any DOM around - it only computes a layout
 * plan that callers can use for a non-destructive page-count indicator.
 */

/** One top-level block to be placed on a page. */
export interface PaginationBlock {
  /** Measured rendered height of the block in CSS px. */
  readonly height: number;
  /** When true, the block must start on a fresh page (manual page or
   *  section break, cover page, etc.). */
  readonly forceBreakBefore?: boolean;
}

/** A single laid-out page: a half-open `[start, end)` range of block
 *  indices plus the total height consumed. */
export interface PaginationPage {
  readonly start: number;
  readonly end: number;
  readonly usedHeight: number;
}

export interface PaginationResult {
  readonly pageCount: number;
  readonly pages: ReadonlyArray<PaginationPage>;
}

/** A document with no content still occupies a single (empty) page. */
const EMPTY_RESULT: PaginationResult = {
  pageCount: 1,
  pages: [{ start: 0, end: 0, usedHeight: 0 }],
};

interface PageAccumulator {
  start: number;
  end: number;
  usedHeight: number;
}

function sealPage(pages: PaginationPage[], page: PageAccumulator): void {
  pages.push({ start: page.start, end: page.end, usedHeight: page.usedHeight });
}

/**
 * Split `blocks` into page-sized groups.
 *
 * A new page is started when either the current block requests a forced
 * break, or appending it would overflow `pageContentHeight` and the page
 * is not already empty.  A block taller than a whole page is placed on
 * its own page (it may visually overflow - that is the caller's concern).
 *
 * `pageContentHeight <= 0` is treated as "unbounded": everything except
 * forced breaks lands on one page.
 */
export function paginate(
  blocks: ReadonlyArray<PaginationBlock>,
  pageContentHeight: number,
): PaginationResult {
  if (blocks.length === 0) return EMPTY_RESULT;

  const bounded = pageContentHeight > 0;
  const pages: PaginationPage[] = [];
  let page: PageAccumulator = { start: 0, end: 0, usedHeight: 0 };

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const height = Math.max(0, block.height);
    const pageEmpty = page.end === page.start;
    const forced = block.forceBreakBefore === true && !pageEmpty;
    const overflow = bounded && !pageEmpty && page.usedHeight + height > pageContentHeight;

    if (forced || overflow) {
      sealPage(pages, page);
      page = { start: i, end: i, usedHeight: 0 };
    }

    page.end = i + 1;
    page.usedHeight += height;
  }

  sealPage(pages, page);
  return { pageCount: pages.length, pages };
}

/** Stable signature for a list of block heights + the page height, used
 *  by hooks to dedupe React state updates and avoid render loops. */
export function paginationSignature(
  blocks: ReadonlyArray<PaginationBlock>,
  pageContentHeight: number,
): string {
  const parts = blocks.map((b) => `${Math.round(b.height)}${b.forceBreakBefore ? "!" : ""}`);
  return `${Math.round(pageContentHeight)}|${parts.join(",")}`;
}

/** CSS class names that mark a top-level block as a forced page break. */
const BREAK_CLASS_RE = /livedoc-(page|section)-break/;

/**
 * Measure the top-level blocks rendered inside `container` (typically the
 * ProseMirror `.ProseMirror` element).  Returns one `PaginationBlock`
 * per direct child, with its rendered height and whether it is a manual
 * break.  Returns an empty array when `container` is null.
 */
export function measureBlocks(container: HTMLElement | null): PaginationBlock[] {
  if (!container) return [];
  const blocks: PaginationBlock[] = [];
  for (const child of Array.from(container.children)) {
    const el = child as HTMLElement;
    // Skip the visible page-gap widgets injected by the pagination
    // decorations - they are view-only chrome, not document blocks.
    if (el.dataset.ldPageGap !== undefined) continue;
    const forceBreakBefore = BREAK_CLASS_RE.test(el.className);
    blocks.push({ height: el.getBoundingClientRect().height, forceBreakBefore });
  }
  return blocks;
}

/**
 * Usable content height of one page in CSS px: the page height minus the
 * top and bottom margins.  Never returns a negative number.
 */
export function pageContentHeightPx(pageHeight: number, marginPx: number): number {
  return Math.max(0, pageHeight - marginPx * 2);
}
