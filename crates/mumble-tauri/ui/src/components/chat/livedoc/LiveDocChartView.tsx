/**
 * LiveDocChartView - React node view for `LiveDocChart`.
 *
 * Renders a live Chart.js chart and, when the chart is clicked, an Excel-like
 * editable data grid below it.  Edits are written straight back to the node's
 * attributes (which persist + sync), and the chart re-renders.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import { Chart, registerables } from "chart.js";
import { DEFAULT_CHART, type ChartPayload, type LiveDocChartType } from "./liveDocChart";
import styles from "./LiveDocChart.module.css";

// Chart.js's overloaded `register`/constructor signatures crash the
// type-checker ("No error for last overload signature") at these call sites,
// so route them through an opaque reference.  The chart config is validated at
// runtime via `parseChartPayload`.
type ChartLike = { destroy(): void };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ChartLib = Chart as any;
ChartLib.register(...registerables);

const PALETTE = ["#2aabee", "#8a5cf6", "#f0428a", "#38b27a", "#e0892f", "#e0533c", "#3c8be0", "#b27a38"];
const TYPES: LiveDocChartType[] = ["bar", "line", "pie", "doughnut"];

// Built as a plain object and cast: Chart.js's per-type config unions are huge
// and confuse the type-checker, so we keep this loosely typed and trust the
// runtime (data is validated in `parseChartPayload`).
function buildConfig(type: LiveDocChartType, payload: ChartPayload): object {
  const pieish = type === "pie" || type === "doughnut";
  const datasets = payload.datasets.map((ds, i) => ({
    label: ds.label,
    data: ds.data,
    backgroundColor: pieish
      ? payload.labels.map((_, j) => PALETTE[j % PALETTE.length])
      : type === "line"
        ? `${PALETTE[i % PALETTE.length]}33`
        : PALETTE[i % PALETTE.length],
    borderColor: pieish ? "#1e2128" : PALETTE[i % PALETTE.length],
    borderWidth: 2,
    fill: !pieish && type === "line",
    tension: 0.3,
  }));
  const config = {
    type,
    data: { labels: payload.labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: pieish || payload.datasets.length > 1,
          position: "bottom",
          labels: { color: "#9aa3ad", boxWidth: 12 },
        },
      },
      scales: pieish
        ? {}
        : {
            x: { ticks: { color: "#9aa3ad" }, grid: { color: "rgba(128,128,128,0.15)" } },
            y: { ticks: { color: "#9aa3ad" }, grid: { color: "rgba(128,128,128,0.15)" } },
          },
    },
  };
  return config;
}

export default function LiveDocChartView({ node, updateAttributes }: NodeViewProps) {
  const { t } = useTranslation("chat");
  const chartType = (node.attrs.chartType as LiveDocChartType) ?? "bar";
  const payload = useMemo<ChartPayload>(() => {
    const d = node.attrs.data;
    if (d && Array.isArray(d.labels) && Array.isArray(d.datasets)) return d as ChartPayload;
    return DEFAULT_CHART;
  }, [node.attrs.data]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<ChartLike | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [drag, setDrag] = useState<{ w: number; h: number } | null>(null);

  const width = (node.attrs.width as number | null) ?? null;
  const height = (node.attrs.height as number | null) ?? 260;

  // Image-style corner resize: drag adjusts the box; Chart.js (responsive)
  // re-fits the canvas automatically as the container changes size.
  const onResizeStart = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = wrapRef.current?.getBoundingClientRect();
    const startW = rect?.width ?? width ?? 520;
    const startH = height;
    const startX = e.clientX;
    const startY = e.clientY;
    const move = (ev: PointerEvent) => {
      setDrag({
        w: Math.max(220, Math.round(startW + (ev.clientX - startX))),
        h: Math.max(140, Math.round(startH + (ev.clientY - startY))),
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.userSelect = "";
      setDrag((d) => {
        if (d) updateAttributes({ width: d.w, height: d.h });
        return null;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    document.body.style.userSelect = "none";
  };

  const boxWidth = drag?.w ?? width;
  const boxHeight = drag?.h ?? height;

  useEffect(() => {
    if (!canvasRef.current) return;
    chartRef.current?.destroy();
    chartRef.current = new ChartLib(canvasRef.current, buildConfig(chartType, payload)) as ChartLike;
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [chartType, payload]);

  const commit = (next: ChartPayload) => updateAttributes({ data: next });
  const clone = (): ChartPayload => ({
    labels: [...payload.labels],
    datasets: payload.datasets.map((d) => ({ label: d.label, data: [...d.data] })),
  });

  const setLabel = (i: number, value: string) => { const n = clone(); n.labels[i] = value; commit(n); };
  const setSeriesName = (j: number, value: string) => { const n = clone(); n.datasets[j].label = value; commit(n); };
  const setValue = (i: number, j: number, value: string) => { const n = clone(); n.datasets[j].data[i] = Number(value) || 0; commit(n); };
  const addRow = () => { const n = clone(); n.labels.push(`Item ${n.labels.length + 1}`); n.datasets.forEach((d) => d.data.push(0)); commit(n); };
  const removeRow = (i: number) => { if (payload.labels.length <= 1) return; const n = clone(); n.labels.splice(i, 1); n.datasets.forEach((d) => d.data.splice(i, 1)); commit(n); };
  const addColumn = () => { const n = clone(); n.datasets.push({ label: `Series ${n.datasets.length + 1}`, data: n.labels.map(() => 0) }); commit(n); };
  const removeColumn = (j: number) => { if (payload.datasets.length <= 1) return; const n = clone(); n.datasets.splice(j, 1); commit(n); };

  return (
    <NodeViewWrapper
      ref={wrapRef}
      className={styles.wrap}
      contentEditable={false}
      data-livedoc-chart=""
      style={{ width: boxWidth != null ? `${boxWidth}px` : undefined }}
    >
      <div className={styles.toolbar}>
        <div className={styles.types}>
          {TYPES.map((ct) => (
            <button
              key={ct}
              type="button"
              className={`${styles.typeBtn} ${chartType === ct ? styles.typeActive : ""}`}
              onClick={() => updateAttributes({ chartType: ct })}
            >
              {t(`liveDoc.insert.chartType.${ct}`, { defaultValue: ct })}
            </button>
          ))}
        </div>
        <button type="button" className={styles.editBtn} onClick={() => setEditing((v) => !v)} aria-pressed={editing}>
          {editing ? t("liveDoc.insert.chartDone", { defaultValue: "Done" }) : t("liveDoc.insert.chartEdit", { defaultValue: "Edit data" })}
        </button>
      </div>

      <div
        className={styles.canvasBox}
        role="button"
        tabIndex={0}
        title={t("liveDoc.insert.chartEdit", { defaultValue: "Edit data" })}
        onClick={() => setEditing(true)}
        style={{ height: `${boxHeight}px` }}
      >
        <canvas ref={canvasRef} />
        <span
          className={styles.resizeHandle}
          role="separator"
          aria-label={t("liveDoc.insert.chartResize", { defaultValue: "Resize chart" })}
          onPointerDown={onResizeStart}
        />
      </div>

      {editing && (
        <div className={styles.grid}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.corner} />
                {payload.datasets.map((ds, j) => (
                  <th key={j} className={styles.seriesHead}>
                    <input value={ds.label} onChange={(e) => setSeriesName(j, e.target.value)} />
                    {payload.datasets.length > 1 && (
                      <button type="button" className={styles.removeBtn} title={t("liveDoc.insert.chartRemoveSeries", { defaultValue: "Remove series" })} onClick={() => removeColumn(j)}>×</button>
                    )}
                  </th>
                ))}
                <th className={styles.addCol}>
                  <button type="button" onClick={addColumn} title={t("liveDoc.insert.chartAddSeries", { defaultValue: "Add series" })}>+</button>
                </th>
              </tr>
            </thead>
            <tbody>
              {payload.labels.map((label, i) => (
                <tr key={i}>
                  <th className={styles.rowHead}>
                    <input value={label} onChange={(e) => setLabel(i, e.target.value)} />
                    {payload.labels.length > 1 && (
                      <button type="button" className={styles.removeBtn} title={t("liveDoc.insert.chartRemoveRow", { defaultValue: "Remove row" })} onClick={() => removeRow(i)}>×</button>
                    )}
                  </th>
                  {payload.datasets.map((ds, j) => (
                    <td key={j}>
                      <input type="number" value={ds.data[i] ?? 0} onChange={(e) => setValue(i, j, e.target.value)} />
                    </td>
                  ))}
                  <td />
                </tr>
              ))}
              <tr>
                <td className={styles.addRow}>
                  <button type="button" onClick={addRow}>{t("liveDoc.insert.chartAddRow", { defaultValue: "+ Row" })}</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </NodeViewWrapper>
  );
}
