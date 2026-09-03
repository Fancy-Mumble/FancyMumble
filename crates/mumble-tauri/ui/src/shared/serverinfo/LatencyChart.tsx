/**
 * The round-trip chart on the Server Info panel.
 *
 * Chart.js on a canvas, rather than the hand-rolled SVG painter this replaces.
 * The client already carries Chart.js - the admin dashboards and Live Doc draw
 * with it - and it brings the parts the painter never had: a crosshair and a
 * tooltip that name the reading under the pointer, an axis that stays put while
 * the window slides, and a plot that exists before the first sample lands
 * instead of after it. The old painter drew nothing at all until a reading
 * arrived, so a feed that never started and a link with nothing to report were
 * the same empty box.
 *
 * Plain React and inline styles, and every colour arrives in `palette`: this
 * lives under `shared/`, where Nebula's MUI theme and Standard's CSS custom
 * properties are both out of reach, so each pack hands down its own.
 */

import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Chart, registerables } from "chart.js";
import {
  LATENCY_WINDOW_SECS,
  latencyGrade,
  summariseLatency,
  type LatencyGrade,
  type LatencySample,
} from "./model";

// Chart.js's overloaded constructor and register signatures defeat the type
// checker, so route them through an opaque reference - the same trick
// `DashboardChart` and `LiveDocChartView` use.
type ChartLike = {
  destroy(): void;
  update(mode?: string): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  options: any;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ChartLib = Chart as any;
ChartLib.register(...registerables);

/** The colours a pack lends the chart, so it looks native to its own frame. */
export interface LatencyPalette {
  /** The line, and the wash beneath it. */
  readonly accent: string;
  /** Behind the plot. */
  readonly surface: string;
  /** Hairline grid, one step off the surface. */
  readonly grid: string;
  /** Axis numbers and the secondary figures. */
  readonly dim: string;
  /** The readout's own ink. */
  readonly text: string;
  /** Tooltip fill and its hairline. */
  readonly tooltip: string;
  readonly tooltipLine: string;
  /** The three latency bands. */
  readonly good: string;
  readonly fair: string;
  readonly poor: string;
  /** Corner rounding, so the plot matches the pack's other cards. */
  readonly radius: string;
}

/** The plot's own height. The wrapper adds the band the time axis needs. */
const PLOT_H = 116;
const AXIS_BAND_H = 22;

/**
 * The vertical rule under the hovered reading.
 *
 * Chart.js draws the tooltip but not the line that ties it to the time axis,
 * and without one a tooltip floating over a curve reads as a label rather than
 * as a moment.
 */
const crosshairPlugin = {
  id: "latencyCrosshair",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  afterDatasetsDraw(chart: any) {
    const active = chart.tooltip?.getActiveElements?.() ?? [];
    if (active.length === 0) return;
    const { ctx, chartArea } = chart;
    const { x } = active[0].element;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, chartArea.top);
    ctx.lineTo(x, chartArea.bottom);
    ctx.lineWidth = 1;
    ctx.strokeStyle = chart.options.plugins.latencyCrosshair.color;
    ctx.stroke();
    ctx.restore();
  },
};

/** The gaps an axis is allowed to count in, smallest first. */
const TICK_STEPS = [5, 10, 15, 20, 25, 30, 50, 75, 100, 125, 150, 200, 250, 500, 1000, 2500];

/** How many gaps the y axis is divided into. */
export const LATENCY_TICKS = 4;

/**
 * The gap between y-axis lines, chosen so four of them clear the window's peak.
 *
 * The scale is redrawn from the data rather than pinned, because a link that
 * runs at 8 ms and one that runs at 400 ms are both worth seeing the shape of.
 * Picking the *step* first and multiplying up - rather than rounding the
 * ceiling and dividing - is what keeps the labels at numbers somebody counts
 * in: a ceiling of 450 over four gaps is 112.5, and an axis reading 0, 113,
 * 225, 338 is arithmetic rather than a scale.
 */
export function latencyStep(peak: number): number {
  const target = Math.max(peak * 1.15, 20);
  return TICK_STEPS.find((step) => step * LATENCY_TICKS >= target) ?? TICK_STEPS[TICK_STEPS.length - 1];
}

/** The top of the scale: four gaps above zero. */
export function latencyCeiling(peak: number): number {
  return latencyStep(peak) * LATENCY_TICKS;
}

/**
 * The three strings the plot itself draws.
 *
 * Resolved by the caller rather than looked up inside the config: handing
 * i18next's `t` across a function boundary drags its whole overload set with
 * it, and the type checker gives out trying to resolve it.
 */
interface LatencyLabels {
  readonly now: string;
  readonly ago: (seconds: number) => string;
  readonly reading: (value: string) => string;
}

interface LatencyChartProps {
  readonly samples: readonly LatencySample[];
  /** Why there are no readings, when that is the reason. */
  readonly error: string | null;
  readonly palette: LatencyPalette;
}

export function LatencyChart({ samples, error, palette }: Readonly<LatencyChartProps>) {
  const { t } = useTranslation("server");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<ChartLike | null>(null);

  const summary = useMemo(() => summariseLatency(samples), [samples]);
  const labels: LatencyLabels = useMemo(
    () => ({
      now: t("infoPanel.latency.axisNow"),
      ago: (seconds: number) => t("infoPanel.latency.axisAgo", { seconds }),
      reading: (value: string) => t("infoPanel.latency.reading", { value }),
    }),
    [t],
  );
  const grade = summary.latest === null ? null : latencyGrade(summary.latest);
  const gradeColor = grade === null ? palette.dim : palette[grade];

  /**
   * The window as the plot draws it: seconds before now on the x axis, so the
   * newest reading sits on the right edge and the axis does not creep.
   */
  const points = useMemo(() => {
    if (samples.length === 0) return [];
    const now = samples[samples.length - 1].at;
    return samples.map((sample) => ({ x: (sample.at - now) / 1000, y: sample.rtt }));
  }, [samples]);

  // Build once per palette; a new reading only mutates the data below, because
  // rebuilding the chart twice a second would restart every animation it has.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    chartRef.current = new ChartLib(canvas, buildConfig(palette, labels)) as ChartLike;
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [palette, labels]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.data.datasets[0].data = points;
    chart.data.datasets[0].pointBackgroundColor = gradeColor;
    chart.options.scales.y.max = latencyCeiling(summary.max);
    chart.options.scales.y.ticks.stepSize = latencyStep(summary.max);
    // "none": the points have already moved one slot left, and animating that
    // slide on every reading turns a steady link into a wobbling one.
    chart.update("none");
  }, [points, gradeColor, summary.max]);

  const caption =
    summary.latest === null
      ? t("infoPanel.latency.captionEmpty")
      : t("infoPanel.latency.caption", {
          seconds: LATENCY_WINDOW_SECS,
          latest: Math.round(summary.latest),
          min: Math.round(summary.min),
          avg: Math.round(summary.avg),
          max: Math.round(summary.max),
        });

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 2 }}>
        <span style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.1, color: palette.text }}>
          {summary.latest === null ? "--" : Math.round(summary.latest)}
        </span>
        <span style={{ fontSize: 12, color: palette.dim }}>{t("infoPanel.latency.unit")}</span>
        {grade !== null && (
          <span
            style={{
              marginLeft: "auto",
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: 11,
              color: palette.dim,
            }}
          >
            <span
              aria-hidden="true"
              style={{ width: 7, height: 7, borderRadius: "50%", background: gradeColor }}
            />
            {t(GRADE_KEYS[grade])}
          </span>
        )}
      </div>

      <div style={{ fontSize: 11, color: palette.dim, marginBottom: 8 }}>
        {summary.count === 0
          ? t("infoPanel.latency.window", { seconds: LATENCY_WINDOW_SECS })
          : t("infoPanel.latency.spread", {
              min: Math.round(summary.min),
              avg: Math.round(summary.avg),
              max: Math.round(summary.max),
            })}
      </div>

      <div
        style={{
          position: "relative",
          height: PLOT_H + AXIS_BAND_H,
          padding: "8px 8px 4px",
          boxSizing: "border-box",
          borderRadius: palette.radius,
          background: palette.surface,
        }}
      >
        <canvas ref={canvasRef} role="img" aria-label={caption} />
        {summary.count === 0 && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0 12px",
              textAlign: "center",
              fontSize: 11,
              color: error === null ? palette.dim : palette.poor,
              pointerEvents: "none",
            }}
          >
            {error === null ? t("infoPanel.latency.collecting") : t("infoPanel.latency.failed", { error })}
          </div>
        )}
      </div>
    </div>
  );
}

const GRADE_KEYS = {
  good: "infoPanel.latency.gradeGood",
  fair: "infoPanel.latency.gradeFair",
  poor: "infoPanel.latency.gradePoor",
} as const satisfies Record<LatencyGrade, string>;

/**
 * One series, so no legend: the readout above the plot names what the line is.
 * The wash under it is the accent faded out towards the baseline, which is a
 * wash and not a second encoding - the line is what carries the value.
 */
function buildConfig(palette: LatencyPalette, labels: LatencyLabels): object {
  return {
    type: "line",
    data: {
      datasets: [
        {
          data: [] as { x: number; y: number }[],
          borderColor: palette.accent,
          borderWidth: 2,
          borderJoinStyle: "round",
          borderCapStyle: "round",
          tension: 0.35,
          fill: "origin",
          // Scriptable: the gradient needs the plot's own height, which does
          // not exist until Chart.js has laid the chart out.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          backgroundColor: (ctx: any) => wash(ctx, palette.accent),
          // Only the newest reading is dotted; a dot on all hundred and twenty
          // of them is a bead curtain, not a chart. The 2px ring is the
          // surface showing through, so the dot stays legible over the line.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          pointRadius: (ctx: any) => (ctx.dataIndex === ctx.dataset.data.length - 1 ? 4 : 0),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          pointHoverRadius: (ctx: any) => (ctx.dataIndex === ctx.dataset.data.length - 1 ? 4 : 3),
          pointBorderColor: palette.surface,
          pointBorderWidth: 2,
          pointBackgroundColor: palette.accent,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      // The hit area is the whole column, so a reading is hoverable without
      // landing on the line itself.
      interaction: { mode: "index", intersect: false },
      layout: { padding: { top: 6, right: 2 } },
      scales: {
        x: {
          type: "linear",
          min: -LATENCY_WINDOW_SECS,
          max: 0,
          grid: { display: false },
          border: { display: false },
          ticks: {
            stepSize: LATENCY_WINDOW_SECS / 4,
            color: palette.dim,
            font: { size: 9 },
            padding: 2,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            callback: (value: any) =>
              Number(value) === 0 ? labels.now : labels.ago(Math.abs(Number(value))),
          },
        },
        y: {
          min: 0,
          max: latencyCeiling(0),
          grid: { color: palette.grid, drawTicks: false },
          border: { display: false },
          ticks: {
            stepSize: latencyStep(0),
            color: palette.dim,
            font: { size: 9 },
            padding: 6,
          },
        },
      },
      plugins: {
        legend: { display: false },
        latencyCrosshair: { color: palette.grid },
        tooltip: {
          displayColors: false,
          backgroundColor: palette.tooltip,
          borderColor: palette.tooltipLine,
          borderWidth: 1,
          titleColor: palette.dim,
          titleFont: { size: 10, weight: "normal" },
          bodyColor: palette.text,
          bodyFont: { size: 12, weight: "600" },
          padding: 8,
          cornerRadius: 6,
          callbacks: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            title: (items: any[]) => {
              const seconds = Math.abs(Math.round(items[0]?.parsed?.x ?? 0));
              return seconds === 0 ? labels.now : labels.ago(seconds);
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            label: (item: any) => labels.reading(item.parsed.y.toFixed(1)),
          },
        },
      },
    },
    plugins: [crosshairPlugin],
  };
}

/** The accent faded to nothing at the baseline. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function wash(ctx: any, accent: string): string | CanvasGradient {
  const { chartArea, ctx: canvas } = ctx.chart;
  if (!chartArea) return "transparent";
  const gradient = canvas.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
  gradient.addColorStop(0, withAlpha(accent, 0.22));
  gradient.addColorStop(1, withAlpha(accent, 0));
  return gradient;
}

/**
 * `color` at `alpha`, for the handful of colour notations a pack's tokens
 * arrive in.
 *
 * `color-mix()` would be shorter, but a canvas gradient stop is parsed by the
 * 2D context and not by CSS, so it has to be a colour the context can read.
 */
export function withAlpha(color: string, alpha: number): string {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (hex) {
    const digits = hex[1];
    const full =
      digits.length === 3
        ? digits
            .split("")
            .map((d) => d + d)
            .join("")
        : digits;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(color.trim());
  if (rgb) {
    const parts = rgb[1].split(/[,/]/).map((p) => p.trim());
    const [r, g, b] = parts;
    // A token that already carries an alpha keeps it as a ceiling, so a
    // translucent accent does not become opaque on its way into the wash.
    const own = parts.length > 3 ? Number(parts[3]) : 1;
    return `rgba(${r}, ${g}, ${b}, ${alpha * (Number.isFinite(own) ? own : 1)})`;
  }
  return color;
}
