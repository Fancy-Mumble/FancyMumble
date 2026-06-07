/**
 * liveDocInsertSvg - generate SVG graphics (shapes / icons / charts) as data
 * URLs so the Insert tab can drop them straight into the document as ordinary
 * (resizable, exportable, round-trippable) images via `setImage`.
 */

const DEFAULT_COLOR = "#2aabee";

/** Wrap an SVG body in a sized root and encode it as a data URL. */
function svgDataUrl(width: number, height: number, body: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${body}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface ShapeDef {
  readonly id: string;
  readonly label: string;
  /** Returns the inner SVG markup for a 120x120 canvas. */
  readonly body: (fill: string, stroke: string) => string;
}

export const SHAPES: readonly ShapeDef[] = [
  { id: "rect", label: "Rectangle", body: (f, s) => `<rect x="8" y="24" width="104" height="72" rx="2" fill="${f}" stroke="${s}" stroke-width="3"/>` },
  { id: "rounded", label: "Rounded", body: (f, s) => `<rect x="8" y="24" width="104" height="72" rx="16" fill="${f}" stroke="${s}" stroke-width="3"/>` },
  { id: "ellipse", label: "Ellipse", body: (f, s) => `<ellipse cx="60" cy="60" rx="52" ry="40" fill="${f}" stroke="${s}" stroke-width="3"/>` },
  { id: "circle", label: "Circle", body: (f, s) => `<circle cx="60" cy="60" r="46" fill="${f}" stroke="${s}" stroke-width="3"/>` },
  { id: "triangle", label: "Triangle", body: (f, s) => `<polygon points="60,14 110,104 10,104" fill="${f}" stroke="${s}" stroke-width="3" stroke-linejoin="round"/>` },
  { id: "diamond", label: "Diamond", body: (f, s) => `<polygon points="60,12 108,60 60,108 12,60" fill="${f}" stroke="${s}" stroke-width="3" stroke-linejoin="round"/>` },
  { id: "pentagon", label: "Pentagon", body: (f, s) => `<polygon points="60,12 110,48 92,106 28,106 10,48" fill="${f}" stroke="${s}" stroke-width="3" stroke-linejoin="round"/>` },
  { id: "hexagon", label: "Hexagon", body: (f, s) => `<polygon points="36,16 84,16 110,60 84,104 36,104 10,60" fill="${f}" stroke="${s}" stroke-width="3" stroke-linejoin="round"/>` },
  { id: "star", label: "Star", body: (f, s) => `<polygon points="60,10 72,46 110,46 79,68 91,104 60,82 29,104 41,68 10,46 48,46" fill="${f}" stroke="${s}" stroke-width="3" stroke-linejoin="round"/>` },
  { id: "arrow", label: "Arrow", body: (f, s) => `<polygon points="10,46 74,46 74,28 112,60 74,92 74,74 10,74" fill="${f}" stroke="${s}" stroke-width="3" stroke-linejoin="round"/>` },
  { id: "line", label: "Line", body: (_f, s) => `<line x1="12" y1="108" x2="108" y2="12" stroke="${s}" stroke-width="4" stroke-linecap="round"/>` },
  { id: "speech", label: "Speech", body: (f, s) => `<path d="M12 20 h96 a8 8 0 0 1 8 8 v44 a8 8 0 0 1 -8 8 H52 l-22 20 v-20 H12 a8 8 0 0 1 -8 -8 V28 a8 8 0 0 1 8 -8 z" fill="${f}" stroke="${s}" stroke-width="3" stroke-linejoin="round"/>` },
  { id: "octagon", label: "Octagon", body: (f, s) => `<polygon points="42,12 78,12 108,42 108,78 78,108 42,108 12,78 12,42" fill="${f}" stroke="${s}" stroke-width="3" stroke-linejoin="round"/>` },
  { id: "parallelogram", label: "Parallelogram", body: (f, s) => `<polygon points="32,28 112,28 88,92 8,92" fill="${f}" stroke="${s}" stroke-width="3" stroke-linejoin="round"/>` },
  { id: "trapezoid", label: "Trapezoid", body: (f, s) => `<polygon points="34,28 86,28 112,92 8,92" fill="${f}" stroke="${s}" stroke-width="3" stroke-linejoin="round"/>` },
  { id: "chevron", label: "Chevron", body: (f, s) => `<polygon points="12,28 72,28 108,60 72,92 12,92 48,60" fill="${f}" stroke="${s}" stroke-width="3" stroke-linejoin="round"/>` },
  { id: "plus", label: "Plus", body: (f, s) => `<polygon points="46,12 74,12 74,46 108,46 108,74 74,74 74,108 46,108 46,74 12,74 12,46 46,46" fill="${f}" stroke="${s}" stroke-width="3" stroke-linejoin="round"/>` },
  { id: "leftArrow", label: "Left arrow", body: (f, s) => `<polygon points="110,46 46,46 46,28 8,60 46,92 46,74 110,74" fill="${f}" stroke="${s}" stroke-width="3" stroke-linejoin="round"/>` },
  { id: "upArrow", label: "Up arrow", body: (f, s) => `<polygon points="46,110 46,46 28,46 60,8 92,46 74,46 74,110" fill="${f}" stroke="${s}" stroke-width="3" stroke-linejoin="round"/>` },
  { id: "downArrow", label: "Down arrow", body: (f, s) => `<polygon points="46,10 46,74 28,74 60,112 92,74 74,74 74,10" fill="${f}" stroke="${s}" stroke-width="3" stroke-linejoin="round"/>` },
  { id: "doubleArrow", label: "Double arrow", body: (f, s) => `<polygon points="8,60 34,40 34,52 86,52 86,40 112,60 86,80 86,68 34,68 34,80" fill="${f}" stroke="${s}" stroke-width="3" stroke-linejoin="round"/>` },
  { id: "heart", label: "Heart", body: (f, s) => `<path d="M60 104 C16 74 12 44 12 36 a24 24 0 0 1 48 -6 a24 24 0 0 1 48 6 c0 8 -4 38 -48 68 z" fill="${f}" stroke="${s}" stroke-width="3" stroke-linejoin="round"/>` },
  { id: "cloud", label: "Cloud", body: (f, s) => `<path d="M36 84 a22 22 0 0 1 2 -44 a26 26 0 0 1 48 -6 a20 20 0 0 1 4 50 z" fill="${f}" stroke="${s}" stroke-width="3" stroke-linejoin="round"/>` },
  { id: "cylinder", label: "Cylinder", body: (f, s) => `<path d="M16 30 a44 12 0 0 1 88 0 v60 a44 12 0 0 1 -88 0 z" fill="${f}" stroke="${s}" stroke-width="3"/><ellipse cx="60" cy="30" rx="44" ry="12" fill="none" stroke="${s}" stroke-width="3"/>` },
  { id: "cross", label: "Cross", body: (_f, s) => `<line x1="20" y1="20" x2="100" y2="100" stroke="${s}" stroke-width="6" stroke-linecap="round"/><line x1="100" y1="20" x2="20" y2="100" stroke="${s}" stroke-width="6" stroke-linecap="round"/>` },
  { id: "lightning", label: "Lightning", body: (f, s) => `<polygon points="66,8 30,66 56,66 46,112 92,48 64,48" fill="${f}" stroke="${s}" stroke-width="3" stroke-linejoin="round"/>` },
  { id: "banner", label: "Banner", body: (f, s) => `<polygon points="12,32 108,32 108,80 64,80 60,92 56,80 12,80" fill="${f}" stroke="${s}" stroke-width="3" stroke-linejoin="round"/>` },
];

function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export function shapeDataUrl(id: string, color: string = DEFAULT_COLOR): string {
  const shape = SHAPES.find((s) => s.id === id) ?? SHAPES[0];
  return svgDataUrl(120, 120, shape.body(withAlpha(color, 0.18), color));
}

// ---------------------------------------------------------------------------
// Icons (24x24 stroke paths, Lucide-style)
// ---------------------------------------------------------------------------

export interface IconDef {
  readonly id: string;
  readonly label: string;
  /** SVG children for a 24x24 viewBox (stroke="currentColor" replaced). */
  readonly svg: string;
}

export const INSERT_ICONS: readonly IconDef[] = [
  { id: "heart", label: "Heart", svg: `<path d="M19 14c1.5-1.5 3-3.2 3-5.5A4.5 4.5 0 0 0 12 6 4.5 4.5 0 0 0 2 8.5C2 10.8 3.5 12.5 5 14l7 7Z"/>` },
  { id: "star", label: "Star", svg: `<polygon points="12 2 15 9 22 9.3 16.5 14 18.5 21 12 17 5.5 21 7.5 14 2 9.3 9 9"/>` },
  { id: "check", label: "Check", svg: `<path d="M20 6 9 17l-5-5"/>` },
  { id: "flag", label: "Flag", svg: `<path d="M4 22V4h13l-2 4 2 4H4"/>` },
  { id: "home", label: "Home", svg: `<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>` },
  { id: "user", label: "User", svg: `<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>` },
  { id: "bell", label: "Bell", svg: `<path d="M6 9a6 6 0 1 1 12 0c0 5 2 7 2 7H4s2-2 2-7"/><path d="M10 20a2 2 0 0 0 4 0"/>` },
  { id: "mail", label: "Mail", svg: `<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>` },
  { id: "phone", label: "Phone", svg: `<path d="M5 3h4l2 5-3 2a12 12 0 0 0 6 6l2-3 5 2v4a2 2 0 0 1-2 2A18 18 0 0 1 3 5a2 2 0 0 1 2-2"/>` },
  { id: "clock", label: "Clock", svg: `<circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/>` },
  { id: "info", label: "Info", svg: `<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>` },
  { id: "warning", label: "Warning", svg: `<path d="M12 3 2 20h20Z"/><path d="M12 10v4M12 17h.01"/>` },
  { id: "lock", label: "Lock", svg: `<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>` },
  { id: "gear", label: "Gear", svg: `<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>` },
  { id: "globe", label: "Globe", svg: `<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18"/>` },
  { id: "pin", label: "Pin", svg: `<path d="M12 22s7-7 7-12a7 7 0 1 0-14 0c0 5 7 12 7 12Z"/><circle cx="12" cy="10" r="2.5"/>` },
];

export function iconDataUrl(id: string, color: string = DEFAULT_COLOR): string {
  const icon = INSERT_ICONS.find((i) => i.id === id) ?? INSERT_ICONS[0];
  const body = `<g fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon.svg}</g>`;
  return svgDataUrl(64, 64, `<g transform="scale(2.667)">${body}</g>`);
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

export type ChartType = "bar" | "line" | "pie";

export function chartDataUrl(type: ChartType, values: number[], color: string = DEFAULT_COLOR): string {
  const data = values.filter((v) => Number.isFinite(v));
  const W = 320;
  const H = 200;
  const pad = 24;
  if (data.length === 0) return svgDataUrl(W, H, `<rect width="${W}" height="${H}" fill="#fff"/>`);
  const max = Math.max(...data, 1);
  const plotW = W - pad * 2;
  const plotH = H - pad * 2;
  const bg = `<rect width="${W}" height="${H}" fill="#ffffff"/><line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="#cbd5e1" stroke-width="1"/>`;

  if (type === "pie") {
    const total = data.reduce((a, b) => a + b, 0) || 1;
    const cx = W / 2;
    const cy = H / 2;
    const r = Math.min(plotW, plotH) / 2;
    let angle = -Math.PI / 2;
    const slices = data
      .map((v, i) => {
        const frac = v / total;
        const next = angle + frac * Math.PI * 2;
        const x1 = cx + r * Math.cos(angle);
        const y1 = cy + r * Math.sin(angle);
        const x2 = cx + r * Math.cos(next);
        const y2 = cy + r * Math.sin(next);
        const large = frac > 0.5 ? 1 : 0;
        angle = next;
        const a = 0.4 + (0.6 * (i + 1)) / data.length;
        return `<path d="M${cx} ${cy} L${x1.toFixed(1)} ${y1.toFixed(1)} A${r} ${r} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z" fill="${withAlpha(color, a)}" stroke="#fff" stroke-width="1.5"/>`;
      })
      .join("");
    return svgDataUrl(W, H, `<rect width="${W}" height="${H}" fill="#ffffff"/>${slices}`);
  }

  if (type === "line") {
    const step = data.length > 1 ? plotW / (data.length - 1) : 0;
    const pts = data.map((v, i) => `${(pad + i * step).toFixed(1)},${(H - pad - (v / max) * plotH).toFixed(1)}`);
    const dots = pts.map((p) => `<circle cx="${p.split(",")[0]}" cy="${p.split(",")[1]}" r="3" fill="${color}"/>`).join("");
    return svgDataUrl(W, H, `${bg}<polyline points="${pts.join(" ")}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>${dots}`);
  }

  // bar
  const gap = 8;
  const barW = (plotW - gap * (data.length - 1)) / data.length;
  const bars = data
    .map((v, i) => {
      const h = (v / max) * plotH;
      const x = pad + i * (barW + gap);
      const y = H - pad - h;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${color}"/>`;
    })
    .join("");
  return svgDataUrl(W, H, `${bg}${bars}`);
}
