/**
 * DashboardChart - a thin Chart.js canvas wrapper for the admin dashboards.
 *
 * Mirrors the lifecycle handling in `LiveDocChartView`: it constructs a chart
 * from a plain config object and destroys/recreates it whenever the config
 * changes.  Callers should `useMemo` the config so the chart isn't rebuilt on
 * every render.
 */

import { useEffect, useRef } from "react";
import { Chart, registerables } from "chart.js";

// Chart.js's overloaded constructor/register signatures defeat the
// type-checker, so route them through an opaque reference (the same trick
// LiveDocChartView uses).  Configs are plain objects validated at runtime.
type ChartLike = { destroy(): void };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ChartLib = Chart as any;
ChartLib.register(...registerables);

interface DashboardChartProps {
  /** A Chart.js configuration object (`{ type, data, options }`). */
  readonly config: object;
  readonly ariaLabel?: string;
  readonly className?: string;
}

export default function DashboardChart({ config, ariaLabel, className }: DashboardChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<ChartLike | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    chartRef.current?.destroy();
    chartRef.current = new ChartLib(canvasRef.current, config) as ChartLike;
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [config]);

  return <canvas ref={canvasRef} role="img" aria-label={ariaLabel} className={className} />;
}
