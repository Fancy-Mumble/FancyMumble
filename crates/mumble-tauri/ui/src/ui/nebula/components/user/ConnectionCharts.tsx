import { useTranslation } from "react-i18next";
import { Box, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { SAMPLE_WINDOW, type StatsSample } from "./userInfoModel";

/**
 * The live figures on the User Information sheet, drawn as the mock draws
 * them: a round-trip line for the last 45 seconds, and a bar strip each for
 * bandwidth and packet loss. Plain SVG - three small pictures do not need a
 * chart library, and SVG can be asserted on in tests where a canvas cannot.
 *
 * Every drawing is scaled to its box with `preserveAspectRatio="none"`, so
 * the stroke widths are pinned with `vector-effect` rather than stretched.
 */

/** The drawing's own coordinate space; the box it lands in decides the pixels. */
const W = 480;

/** Slot `index` of `count` samples, newest at the right edge. */
function slotX(index: number, count: number): number {
  const slots = Math.max(SAMPLE_WINDOW, count);
  return ((index + (slots - count)) / (slots - 1)) * W;
}

function polyline(points: readonly (readonly [number, number])[]): string {
  return points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
}

interface RoundTripChartProps {
  samples: readonly StatsSample[];
  height?: number;
}

/**
 * UDP and TCP round trips over the window.
 *
 * UDP is the voice path and takes the accent; TCP is drawn dashed in the text
 * colour, so the two read apart by line style before they do by colour. The
 * range is the data's own, labelled at both ends, because a ping chart pinned
 * to zero is a flat line for anyone on a decent connection.
 */
export function RoundTripChart({ samples, height = 64 }: Readonly<RoundTripChartProps>) {
  const { t } = useTranslation("nebulaUser");
  const { nebula } = useTheme().palette;
  const count = samples.length;
  const latest = samples[count - 1];
  const values = samples.flatMap((sample) => [sample.udpPing, sample.tcpPing]);
  const low = Math.min(...values);
  const high = Math.max(...values);
  // Room above and below the lines for the range labels to sit clear of them.
  const pad = Math.max((high - low) * 0.3, 1);
  const top = high + pad;
  const bottom = Math.max(0, low - pad);
  const y = (value: number) => ((top - value) / (top - bottom)) * height;

  const udp = samples.map((sample, index) => [slotX(index, count), y(sample.udpPing)] as const);
  const tcp = samples.map((sample, index) => [slotX(index, count), y(sample.tcpPing)] as const);
  const area =
    udp.length > 1
      ? `${polyline(udp)} L${udp[udp.length - 1][0].toFixed(1)} ${height} L${udp[0][0].toFixed(1)} ${height} Z`
      : "";

  const summary = latest
    ? t("charts.roundTrip", {
        seconds: SAMPLE_WINDOW,
        udp: latest.udpPing.toFixed(1),
        tcp: latest.tcpPing.toFixed(1),
        low: low.toFixed(0),
        high: high.toFixed(0),
      })
    : t("charts.roundTripEmpty");

  return (
    <Box
      sx={{ position: "relative", height, borderRadius: "8px", overflow: "hidden", background: nebula.card2 }}
    >
      <svg
        role="img"
        aria-label={summary}
        viewBox={`0 0 ${W} ${height}`}
        preserveAspectRatio="none"
        style={{ display: "block", width: "100%", height }}
      >
        {[0.25, 0.5, 0.75].map((step) => (
          <line
            key={step}
            x1={0}
            x2={W}
            y1={height * step}
            y2={height * step}
            stroke={nebula.line}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {count > 1 && (
          <>
            <path d={area} fill={nebula.accent} fillOpacity={0.14} />
            <path
              data-series="tcp"
              d={polyline(tcp)}
              fill="none"
              stroke={nebula.text}
              strokeOpacity={0.75}
              strokeWidth={1.5}
              strokeDasharray="4 3"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
            <path
              data-series="udp"
              d={polyline(udp)}
              fill="none"
              stroke={nebula.accent}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </>
        )}
      </svg>
      {count > 1 ? (
        <>
          <Scale at="top">{t("charts.milliseconds", { value: high.toFixed(0) })}</Scale>
          <Scale at="bottom">{t("charts.milliseconds", { value: low.toFixed(0) })}</Scale>
        </>
      ) : (
        <Typography
          sx={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 11,
            color: nebula.dim,
          }}
        >
          {t("charts.collecting")}
        </Typography>
      )}
    </Box>
  );
}

/** The range's end, written faintly inside the plot where the mock puts it. */
function Scale({ at, children }: Readonly<{ at: "top" | "bottom"; children: string }>) {
  return (
    <Typography
      component="span"
      sx={(theme) => ({
        position: "absolute",
        left: 6,
        [at]: 4,
        px: "4px",
        borderRadius: "4px",
        fontSize: 9.5,
        lineHeight: 1.4,
        color: theme.palette.nebula.dim,
        // Backed, since a peak at the left edge would otherwise run through it.
        background: theme.palette.nebula.card2,
        pointerEvents: "none",
      })}
    >
      {children}
    </Typography>
  );
}

interface BarStripProps {
  /** One value per sample; null draws an empty slot. */
  values: readonly (number | null)[];
  /** The bars' colour. */
  color: string;
  /** How a value reads on its bar's tooltip. */
  format: (value: number) => string;
  label: string;
  height?: number;
}

/**
 * One thin bar per reading, newest at the right, scaled to the window's own
 * largest value. A slot with no reading is drawn as a stub rather than left
 * out, so the strip keeps its time axis.
 */
export function BarStrip({ values, color, format, label, height = 26 }: Readonly<BarStripProps>) {
  const { t } = useTranslation("nebulaUser");
  const { nebula } = useTheme().palette;
  const slots = Math.max(SAMPLE_WINDOW, values.length);
  const step = W / slots;
  const gap = step * 0.35;
  const known = values.filter((value): value is number => value !== null);
  const max = Math.max(...known, 0) || 1;
  const offset = slots - values.length;

  return (
    <svg
      role="img"
      aria-label={
        known.length
          ? t("charts.seriesLatest", { label, value: format(known[known.length - 1]) })
          : t("charts.seriesEmpty", { label })
      }
      viewBox={`0 0 ${W} ${height}`}
      preserveAspectRatio="none"
      style={{ display: "block", width: "100%", height }}
    >
      {values.map((value, index) => {
        const x = (offset + index) * step + gap / 2;
        const barHeight = value === null ? 2 : Math.max(2, (value / max) * height);
        return (
          <rect
            key={index}
            x={x}
            y={height - barHeight}
            width={step - gap}
            height={barHeight}
            rx={1}
            fill={value === null ? nebula.line : color}
          >
            <title>{value === null ? t("charts.noReading") : format(value)}</title>
          </rect>
        );
      })}
    </svg>
  );
}
