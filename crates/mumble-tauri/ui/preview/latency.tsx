import { createRoot } from "react-dom/client";
import { Box, CssBaseline } from "@mui/material";
import { ThemeProvider, useTheme, alpha } from "@mui/material/styles";
import { createNebulaTheme } from "@nebula/theme";
import { radius } from "@nebula/tokens";
import { LatencyChart, type LatencyPalette } from "@shared/serverinfo/LatencyChart";
import type { LatencySample } from "@shared/serverinfo/model";
import "@core/i18n";
import "@standard/theme.css";

/**
 * The Server Info latency chart, in both packs' colours and all three of its
 * states, without a server behind it. `npx vite build --config
 * preview/vite.latency.config.ts`, then open `preview/dist-latency/latency.html`.
 */

/** A minute of readings at the 2 Hz the ping test runs at, with one spike. */
function synth(base: number, spikeAt: number | null): LatencySample[] {
  const now = 60_000;
  return Array.from({ length: 120 }, (_, index) => {
    const wobble = Math.sin(index / 7) * base * 0.14 + Math.sin(index / 2.3) * base * 0.06;
    const spike =
      spikeAt !== null && Math.abs(index - spikeAt) < 4 ? base * (4 - Math.abs(index - spikeAt)) : 0;
    return { at: now - (119 - index) * 500, rtt: Math.max(1, base + wobble + spike) };
  });
}

function nebulaPalette(): LatencyPalette {
  const { nebula } = useTheme().palette;
  return {
    accent: nebula.accent,
    surface: nebula.card2,
    grid: alpha(nebula.text, 0.1),
    dim: nebula.dim,
    text: nebula.text,
    tooltip: nebula.card,
    tooltipLine: nebula.line,
    good: nebula.ok,
    fair: nebula.warn,
    poor: nebula.bad,
    radius: radius("md"),
  };
}

function standardPalette(): LatencyPalette {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    accent: token("--color-accent", "#468cdc"),
    surface: token("--color-overlay-light", "rgba(0, 0, 0, 0.2)"),
    grid: token("--color-glass-border", "rgba(255, 255, 255, 0.08)"),
    dim: token("--color-text-muted", "rgba(255, 255, 255, 0.4)"),
    text: token("--color-text-primary", "#ffffff"),
    tooltip: token("--color-bg-elevated", "#303030"),
    tooltipLine: token("--color-glass-border", "rgba(255, 255, 255, 0.08)"),
    good: token("--color-online", "#3dbc5c"),
    fair: token("--color-warning", "#d4a020"),
    poor: token("--color-danger", "#e04848"),
    radius: "4px",
  };
}

/** One fold, drawn the way Nebula's panel draws it. */
function Fold({ title, children }: Readonly<{ title: string; children: React.ReactNode }>) {
  return (
    <Box
      sx={(t) => ({
        width: 296,
        border: `1px solid ${t.palette.nebula.line}`,
        borderRadius: radius("md"),
        overflow: "hidden",
      })}
    >
      <Box
        sx={(t) => ({
          px: "12px",
          py: "9px",
          fontSize: 12,
          fontWeight: 600,
          color: t.palette.nebula.text,
          background: t.palette.nebula.card,
        })}
      >
        {title}
      </Box>
      <Box sx={(t) => ({ px: "12px", py: "10px", borderTop: `1px solid ${t.palette.nebula.line}` })}>
        {children}
      </Box>
    </Box>
  );
}

function Gallery() {
  const nebula = nebulaPalette();
  const standard = standardPalette();
  return (
    <Box sx={{ display: "flex", gap: 2, p: 3, alignItems: "flex-start", flexWrap: "wrap" }}>
      <Fold title="Network latency">
        <LatencyChart samples={synth(21, null)} error={null} palette={nebula} />
      </Fold>
      <Fold title="Network latency (spike)">
        <LatencyChart samples={synth(64, 92)} error={null} palette={nebula} />
      </Fold>
      <Fold title="Network latency (no readings)">
        <LatencyChart samples={[]} error={null} palette={nebula} />
      </Fold>
      <Fold title="Network latency (failed)">
        <LatencyChart samples={[]} error="Not connected" palette={nebula} />
      </Fold>
      <Fold title="Standard pack">
        <LatencyChart samples={synth(21, null)} error={null} palette={standard} />
      </Fold>
    </Box>
  );
}

document.documentElement.setAttribute("data-theme", "apprentice");

/** Park the pointer over the second card, so the crosshair and tooltip show. */
setTimeout(() => {
  const canvas = document.querySelectorAll("canvas")[1];
  if (!canvas) return;
  const box = canvas.getBoundingClientRect();
  const at = { clientX: box.left + box.width * 0.62, clientY: box.top + box.height * 0.5, bubbles: true };
  canvas.dispatchEvent(new MouseEvent("mousemove", at));
}, 600);

createRoot(document.getElementById("root")!).render(
  <ThemeProvider theme={createNebulaTheme("dark")}>
    <CssBaseline />
    <Box sx={(t) => ({ minHeight: "100vh", background: t.palette.nebula.bg0 })}>
      <Gallery />
    </Box>
  </ThemeProvider>,
);
