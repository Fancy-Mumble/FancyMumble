/**
 * Unit tests for the pure pagination foundation (roadmap item 5).
 *
 * The planner is DOM-free: it consumes measured block heights + a page
 * content height and reports how the blocks split across pages.  These
 * tests pin the splitting, forced-break, overflow and signature logic.
 */
import { describe, expect, it } from "vitest";
import {
  paginate,
  paginationSignature,
  pageContentHeightPx,
  type PaginationBlock,
} from "../chat/livedoc/liveDocPagination";

const block = (height: number, forceBreakBefore = false): PaginationBlock => ({
  height,
  forceBreakBefore,
});

describe("paginate", () => {
  it("treats an empty document as a single empty page", () => {
    const result = paginate([], 1000);
    expect(result.pageCount).toBe(1);
    expect(result.pages).toEqual([{ start: 0, end: 0, usedHeight: 0 }]);
  });

  it("keeps blocks that fit on one page together", () => {
    const result = paginate([block(100), block(200), block(300)], 1000);
    expect(result.pageCount).toBe(1);
    expect(result.pages[0]).toEqual({ start: 0, end: 3, usedHeight: 600 });
  });

  it("splits onto a new page when the next block overflows", () => {
    const result = paginate([block(600), block(600)], 1000);
    expect(result.pageCount).toBe(2);
    expect(result.pages[0]).toEqual({ start: 0, end: 1, usedHeight: 600 });
    expect(result.pages[1]).toEqual({ start: 1, end: 2, usedHeight: 600 });
  });

  it("fills a page exactly without spilling", () => {
    const result = paginate([block(500), block(500), block(10)], 1000);
    expect(result.pageCount).toBe(2);
    expect(result.pages[0]).toEqual({ start: 0, end: 2, usedHeight: 1000 });
    expect(result.pages[1].usedHeight).toBe(10);
  });

  it("places an oversized block on its own page", () => {
    const result = paginate([block(100), block(2000), block(100)], 1000);
    expect(result.pageCount).toBe(3);
    expect(result.pages[1]).toEqual({ start: 1, end: 2, usedHeight: 2000 });
  });

  it("honours a forced break before a block even if it would fit", () => {
    const result = paginate([block(100), block(100, true), block(100)], 1000);
    expect(result.pageCount).toBe(2);
    expect(result.pages[0]).toEqual({ start: 0, end: 1, usedHeight: 100 });
    expect(result.pages[1]).toEqual({ start: 1, end: 3, usedHeight: 200 });
  });

  it("ignores a forced break on the first block (page already empty)", () => {
    const result = paginate([block(100, true), block(100)], 1000);
    expect(result.pageCount).toBe(1);
    expect(result.pages[0]).toEqual({ start: 0, end: 2, usedHeight: 200 });
  });

  it("treats a non-positive page height as unbounded", () => {
    const result = paginate([block(900), block(900), block(900)], 0);
    expect(result.pageCount).toBe(1);
    expect(result.pages[0].end).toBe(3);
  });

  it("still applies forced breaks when unbounded", () => {
    const result = paginate([block(900), block(900, true)], 0);
    expect(result.pageCount).toBe(2);
  });

  it("clamps negative block heights to zero", () => {
    const result = paginate([block(-50), block(100)], 1000);
    expect(result.pages[0].usedHeight).toBe(100);
  });
});

describe("paginationSignature", () => {
  it("is stable for identical inputs", () => {
    const blocks = [block(100), block(200, true)];
    expect(paginationSignature(blocks, 1000)).toBe(paginationSignature(blocks, 1000));
  });

  it("changes when a height changes", () => {
    const a = paginationSignature([block(100)], 1000);
    const b = paginationSignature([block(101)], 1000);
    expect(a).not.toBe(b);
  });

  it("changes when a forced break is toggled", () => {
    const a = paginationSignature([block(100)], 1000);
    const b = paginationSignature([block(100, true)], 1000);
    expect(a).not.toBe(b);
  });

  it("changes when the page height changes", () => {
    const a = paginationSignature([block(100)], 1000);
    const b = paginationSignature([block(100)], 900);
    expect(a).not.toBe(b);
  });

  it("rounds sub-pixel heights so jitter does not churn", () => {
    const a = paginationSignature([block(100.2)], 1000);
    const b = paginationSignature([block(100.4)], 1000);
    expect(a).toBe(b);
  });
});

describe("pageContentHeightPx", () => {
  it("subtracts top and bottom margins", () => {
    expect(pageContentHeightPx(1100, 72)).toBe(956);
  });

  it("never returns a negative value", () => {
    expect(pageContentHeightPx(100, 200)).toBe(0);
  });
});
