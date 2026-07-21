/**
 * Tests for the pagination gap planner (`planPagination`) and the gutter
 * widget DOM (`buildGap`).  The planner's page count drives how many editable
 * header/footer bands React lays out (one per page), so pinning it here keeps
 * the per-page bands aligned with the on-screen sheet gutters.
 */

import { describe, expect, it } from "vitest";
import { planPagination, buildGap, GAP_BAND_PX } from "../chat/livedoc/liveDocPaginationDecorations";

const block = (pos: number, eff: number, forced = false) => ({ pos, eff, forced });

describe("planPagination", () => {
  it("plans one gap per page boundary and reports each page's start block", () => {
    // Six 100px blocks, 250px usable page -> 2 blocks per page -> 3 pages.
    const blocks = [0, 2, 4, 6, 8, 10].map((pos) => block(pos, 100));
    const { gaps, trailingFiller, pageStartBlocks } = planPagination(blocks, 250, 40);

    expect(pageStartBlocks).toEqual([0, 2, 4]);
    expect(gaps).toHaveLength(2);
    // Gaps anchor at the first block of the *opening* page.
    expect(gaps.map((g) => g.pos)).toEqual([4, 8]);
    // 250 usable - 200 used = 50px filler; total = filler + 2*margin + gutter.
    expect(gaps[0].filler).toBe(50);
    expect(gaps[0].total).toBe(50 + 40 * 2 + GAP_BAND_PX);
    expect(trailingFiller).toBe(50);
  });

  it("reports a single page and no gaps when everything fits", () => {
    const blocks = [block(0, 100), block(2, 100)];
    const { gaps, pageStartBlocks } = planPagination(blocks, 1000, 40);
    expect(pageStartBlocks).toEqual([0]);
    expect(gaps).toHaveLength(0);
  });

  it("breaks a page at a forced (manual) break", () => {
    const blocks = [block(0, 50), block(2, 50, true), block(4, 50)];
    const { gaps, pageStartBlocks } = planPagination(blocks, 1000, 40);
    expect(pageStartBlocks).toEqual([0, 1]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].pos).toBe(2);
  });
});

describe("buildGap", () => {
  it("renders the inter-sheet gutter band at the requested offset", () => {
    const el = buildGap(/* total */ 200, /* gapTop */ 120);
    expect(el.classList.contains("livedoc-page-gap")).toBe(true);
    expect(el.style.height).toBe("200px");

    const band = el.querySelector<HTMLElement>(".livedoc-page-gap-band");
    expect(band).not.toBeNull();
    expect(band?.style.top).toBe("120px");
    expect(band?.style.height).toBe(`${GAP_BAND_PX}px`);
  });
});
