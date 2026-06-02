/**
 * liveDocPaginationDecorations - draws *visible* automatic page breaks.
 *
 * ProseMirror renders the document as one continuous flow, so without help
 * the editor surface looks like a single endless page even though the
 * content spans several "pages".  This Tiptap extension measures the
 * rendered top-level blocks, runs the pure `paginate()` planner to find
 * where each page ends, and inserts **widget decorations** at those
 * boundaries.  Each widget:
 *
 *   1. fills the leftover space of the page it closes, so the previous
 *      page's content reaches the bottom margin instead of stopping early;
 *   2. draws the page's bottom/top margins plus a grey inter-sheet gutter,
 *      so following content visibly starts on a fresh sheet.
 *
 * Crucially these are *decorations*: pure view state with zero document
 * steps.  Nothing is written to the shared Yjs doc, so pagination never
 * syncs and never conflicts - every peer paginates locally from its own
 * font metrics / page setup.  Manual page/section breaks remain real
 * (synced) nodes and keep their own dashed divider.
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { EditorView } from "@tiptap/pm/view";
import { paginate } from "./liveDocPagination";

/** Height in px of the grey gutter drawn between two sheets. */
const GAP_BAND_PX = 26;
/** Height in px of the footer band rendered at the bottom of each page gap. */
const FOOTER_BAND_PX = 28;

/** Optional per-page footer rendered inside every automatic page-gap widget. */
interface FooterConfig {
  readonly footerText: string;
  readonly showPageNumber: boolean;
  /** Total number of pages — included in the widget cache key so the DOM is
   *  recreated (and page labels updated) whenever the count changes. */
  readonly pageCount: number;
  /** Formats a 1-based page number into display text, e.g. "Page 3 of 5". */
  readonly pageNumberLabel: (pageNumber: number) => string;
}

interface PageMetrics {
  /** Usable content height of one page (page height - 2 * margin). */
  readonly pageContentHeight: number;
  /** Vertical page margin in px (drawn as whitespace either side of the gap). */
  readonly marginY: number;
  /** When set, each page-gap widget renders a footer band for the closing page. */
  readonly footer?: FooterConfig;
}

interface PaginationPluginState {
  readonly metrics: PageMetrics;
  readonly decorations: DecorationSet;
}

const paginationKey = new PluginKey<PaginationPluginState>("liveDocPagination");

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    liveDocPagination: {
      /** Push the current page geometry so the gutters land at the right
       *  spots.  Called from React whenever page size / margins change. */
      setPaginationMetrics: (metrics: PageMetrics) => ReturnType;
    };
  }
}

/** Build the DOM for one page-gap widget (filler + optional footer + grey gutter band). */
function buildGap(
  totalHeight: number,
  gapTop: number,
  pageNumber: number,
  footer: FooterConfig | undefined,
): HTMLElement {
  const el = document.createElement("div");
  el.className = "livedoc-page-gap";
  el.setAttribute("data-ld-page-gap", "");
  el.setAttribute("contenteditable", "false");
  el.style.height = `${totalHeight}px`;

  if (footer && (footer.footerText || footer.showPageNumber)) {
    const footerEl = document.createElement("div");
    footerEl.className = "livedoc-page-gap-footer";
    footerEl.style.top = `${gapTop - FOOTER_BAND_PX - 4}px`;

    const textSpan = document.createElement("span");
    textSpan.className = "livedoc-page-gap-footer-text";
    textSpan.textContent = footer.footerText;
    footerEl.appendChild(textSpan);

    if (footer.showPageNumber) {
      const numSpan = document.createElement("span");
      numSpan.className = "livedoc-page-gap-footer-num";
      numSpan.textContent = footer.pageNumberLabel(pageNumber);
      footerEl.appendChild(numSpan);
    }

    el.appendChild(footerEl);
  }

  const band = document.createElement("div");
  band.className = "livedoc-page-gap-band";
  band.style.top = `${gapTop}px`;
  band.style.height = `${GAP_BAND_PX}px`;
  el.appendChild(band);
  return el;
}

/** Build the trailing spacer that pads the final page's content area out to a
 *  full sheet, so the last (or only) page is always full paper height even
 *  when its content is short.  Purely visual; never editable. */
function buildTrailingFiller(height: number): HTMLElement {
  const el = document.createElement("div");
  el.className = "livedoc-page-tail";
  el.setAttribute("data-ld-page-tail", "");
  el.setAttribute("contenteditable", "false");
  el.style.height = `${height}px`;
  return el;
}

interface MeasuredBlock {
  readonly pos: number;
  readonly top: number;
  readonly height: number;
  readonly forced: boolean;
  eff: number;
}

/**
 * Measure the editor's top-level blocks and return the widget decorations
 * for every automatic page boundary, or `null` when nothing should change.
 *
 * Heights are taken from the *document* nodes (via `nodeDOM`) rather than
 * `view.dom.children`, and the heights of any gap widgets we previously
 * inserted are subtracted out, so the measurement reflects the intrinsic
 * content layout and re-measuring after our own insertion is stable (no
 * feedback loop).
 */
function measure(view: EditorView): { signature: string; decorations: Decoration[] } | null {
  const pluginState = paginationKey.getState(view.state);
  if (!pluginState) return null;
  const { pageContentHeight, marginY } = pluginState.metrics;
  if (pageContentHeight <= 0) return { signature: "unbounded", decorations: [] };

  // Heights of gap widgets already in the view, keyed by their position, so
  // we can subtract them back out of the live layout measurements.
  const prevGapHeight = new Map<number, number>();
  pluginState.decorations.find().forEach((d) => {
    const h = (d.spec as { ldHeight?: number } | null)?.ldHeight;
    if (typeof h === "number") prevGapHeight.set(d.from, h);
  });

  const rootTop = view.dom.getBoundingClientRect().top;
  const blocks: MeasuredBlock[] = [];
  let gapAbove = 0;
  view.state.doc.forEach((node, offset) => {
    const gap = prevGapHeight.get(offset);
    if (gap) gapAbove += gap;
    const dom = view.nodeDOM(offset);
    let top = 0;
    let height = 0;
    if (dom instanceof HTMLElement) {
      const rect = dom.getBoundingClientRect();
      top = rect.top - rootTop - gapAbove;
      height = rect.height;
    }
    const forced = node.type.name === "pageBreak" || node.type.name === "sectionBreak";
    blocks.push({ pos: offset, top, height, forced, eff: 0 });
  });

  // Effective height = distance to the next block's top (captures the
  // margins between blocks); the last block uses its own measured height.
  for (let i = 0; i < blocks.length; i++) {
    const next = blocks[i + 1];
    blocks[i].eff = next ? Math.max(0, next.top - blocks[i].top) : blocks[i].height;
  }

  const { pages } = paginate(
    blocks.map((b) => ({ height: b.eff, forceBreakBefore: b.forced })),
    pageContentHeight,
  );

  const decorations: Decoration[] = [];
  const footer = pluginState.metrics.footer;
  const footerSig = footer ? `${footer.footerText}:${footer.showPageNumber}:${footer.pageCount}` : "";
  const sigParts: string[] = [`${Math.round(pageContentHeight)}/${Math.round(marginY)}/${footerSig}`];
  for (let p = 1; p < pages.length; p++) {
    const startIdx = pages[p].start;
    const block = blocks[startIdx];
    if (!block) continue;
    // Manual page/section breaks already render their own divider.
    if (block.forced) continue;
    const filler = Math.max(0, pageContentHeight - pages[p - 1].usedHeight);
    const total = filler + marginY * 2 + GAP_BAND_PX;
    const gapTop = filler + marginY;
    sigParts.push(`${block.pos}:${Math.round(total)}`);
    const pageNumber = p;
    decorations.push(
      Decoration.widget(block.pos, () => buildGap(total, gapTop, pageNumber, footer), {
        side: -1,
        ignoreSelection: true,
        key: `ld-page-gap-${block.pos}-${Math.round(total)}-${footer?.pageCount ?? 0}`,
        ldHeight: total,
      } as Parameters<typeof Decoration.widget>[2] & { ldHeight: number }),
    );
  }

  // Pad the final page's content area out to a whole sheet so the last (or
  // only) page is always full paper height, even with little/no content.
  const lastPage = pages[pages.length - 1];
  const trailingFiller = lastPage ? Math.max(0, pageContentHeight - lastPage.usedHeight) : 0;
  if (trailingFiller > 1) {
    const endPos = view.state.doc.content.size;
    sigParts.push(`tail:${Math.round(trailingFiller)}`);
    decorations.push(
      Decoration.widget(endPos, () => buildTrailingFiller(trailingFiller), {
        side: 1,
        ignoreSelection: true,
        key: `ld-page-tail-${Math.round(trailingFiller)}`,
        ldHeight: trailingFiller,
      } as Parameters<typeof Decoration.widget>[2] & { ldHeight: number }),
    );
  }

  return { signature: sigParts.join("|"), decorations };
}

export const LiveDocPaginationDecorations = Extension.create({
  name: "liveDocPaginationDecorations",

  addCommands() {
    return {
      setPaginationMetrics:
        (metrics: PageMetrics) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(paginationKey, { metrics }));
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<PaginationPluginState>({
        key: paginationKey,
        state: {
          init: () => ({
            metrics: { pageContentHeight: 0, marginY: 0 },
            decorations: DecorationSet.empty,
          }),
          apply(tr, prev) {
            const meta = tr.getMeta(paginationKey) as
              | { metrics?: PageMetrics; decorations?: DecorationSet }
              | undefined;
            const metrics = meta?.metrics ?? prev.metrics;
            const decorations =
              meta?.decorations ?? prev.decorations.map(tr.mapping, tr.doc);
            return { metrics, decorations };
          },
        },
        props: {
          decorations: (state) => paginationKey.getState(state)?.decorations,
        },
        view: (view) => {
          let raf = 0;
          let signature = "";

          const recompute = () => {
            raf = 0;
            const result = measure(view);
            if (!result || result.signature === signature) return;
            signature = result.signature;
            const decorations = DecorationSet.create(view.state.doc, result.decorations);
            view.dispatch(
              view.state.tr.setMeta(paginationKey, { decorations }).setMeta("addToHistory", false),
            );
          };
          const schedule = () => {
            if (raf) return;
            raf = requestAnimationFrame(recompute);
          };

          const observer = new ResizeObserver(schedule);
          observer.observe(view.dom);
          schedule();

          return {
            update: schedule,
            destroy: () => {
              observer.disconnect();
              if (raf) cancelAnimationFrame(raf);
            },
          };
        },
      }),
    ];
  },
});

export default LiveDocPaginationDecorations;
