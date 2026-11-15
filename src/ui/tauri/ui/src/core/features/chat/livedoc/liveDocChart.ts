/**
 * LiveDocChart - a Tiptap node backing a real (Chart.js) chart with an
 * Excel-like editable data grid.
 *
 * The node stores only the data + type as `data-*` attributes (so it
 * round-trips through the Markdown serializer as raw HTML).  The live chart
 * canvas and the click-to-edit grid are rendered by the React node view
 * (`LiveDocChartView`), wired up in `LiveDocEditor`.
 */

import { Node, mergeAttributes } from "@tiptap/core";

export type LiveDocChartType = "bar" | "line" | "pie" | "doughnut";

export interface ChartDataset {
  label: string;
  data: number[];
}

export interface ChartPayload {
  labels: string[];
  datasets: ChartDataset[];
}

export const DEFAULT_CHART: ChartPayload = {
  labels: ["Q1", "Q2", "Q3", "Q4"],
  datasets: [{ label: "Series 1", data: [4, 8, 6, 10] }],
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    liveDocChart: {
      insertLiveDocChart: (attrs?: { chartType?: LiveDocChartType; data?: ChartPayload }) => ReturnType;
    };
  }
}

/** Parse a `data-chart` JSON attribute, falling back to a default. */
export function parseChartPayload(raw: string | null): ChartPayload {
  if (!raw) return DEFAULT_CHART;
  try {
    const parsed = JSON.parse(raw) as Partial<ChartPayload>;
    if (Array.isArray(parsed.labels) && Array.isArray(parsed.datasets)) {
      return {
        labels: parsed.labels.map((l) => String(l)),
        datasets: parsed.datasets.map((d) => ({
          label: String(d.label ?? ""),
          data: (Array.isArray(d.data) ? d.data : []).map((n) => Number(n) || 0),
        })),
      };
    }
  } catch {
    /* fall through */
  }
  return DEFAULT_CHART;
}

export const LiveDocChart = Node.create({
  name: "liveDocChart",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    const sizeAttr = (attr: string) => ({
      default: null as number | null,
      parseHTML: (el: HTMLElement) => {
        const v = el.getAttribute(attr);
        const n = v ? parseInt(v, 10) : NaN;
        return Number.isFinite(n) ? n : null;
      },
      renderHTML: (attrs: Record<string, unknown>) => {
        const v = attrs[attr === "data-w" ? "width" : "height"];
        return typeof v === "number" ? { [attr]: String(v) } : {};
      },
    });
    return {
      chartType: {
        default: "bar" as LiveDocChartType,
        parseHTML: (el) => (el.getAttribute("data-chart-type") as LiveDocChartType) || "bar",
        renderHTML: (attrs) => ({ "data-chart-type": attrs.chartType }),
      },
      data: {
        default: DEFAULT_CHART,
        parseHTML: (el) => parseChartPayload(el.getAttribute("data-chart")),
        renderHTML: (attrs) => ({ "data-chart": JSON.stringify(attrs.data) }),
      },
      width: sizeAttr("data-w"),
      height: sizeAttr("data-h"),
    };
  },

  parseHTML() {
    return [{ tag: "div[data-livedoc-chart]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-livedoc-chart": "", class: "ld-chart" })];
  },

  addCommands() {
    return {
      insertLiveDocChart:
        (attrs) =>
        ({ chain }) =>
          chain()
            .focus()
            .insertContent({
              type: this.name,
              attrs: { chartType: attrs?.chartType ?? "bar", data: attrs?.data ?? DEFAULT_CHART },
            })
            .run(),
    };
  },
});

export default LiveDocChart;
