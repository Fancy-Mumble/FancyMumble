/**
 * liveDocFrontMatter - Pandoc-style YAML metadata for the page furniture.
 *
 * The document's layout settings live in the shared Yjs `meta` map, not in the
 * document body, so they were invisible in the Markdown view.  This surfaces
 * them as a leading `--- ... ---` metadata block (the same shape Pandoc reads):
 *
 *   ---
 *   page-size: a4
 *   orientation: portrait
 *   margin: normal
 *   columns: 2
 *   header: "Quarterly report"
 *   footer: "Confidential"
 *   page-numbers: page-of
 *   border: thin
 *   watermark: "DRAFT"
 *   ---
 *
 * The block is the source of truth while it is present.  For the (independent)
 * header / footer / page-number *zones*, a missing `header:` / `footer:` /
 * `page-numbers:` key turns that zone off.  For the enumerated layout values
 * (page geometry + decoration), a present key patches that field and a missing
 * key leaves it untouched - so editing the body never wipes the page geometry.
 * Deleting the whole block leaves every setting as-is (it simply re-appears on
 * the next refresh).
 */

import {
  BAND_STYLES,
  PAGE_NUMBER_STYLES,
  type LiveDocBandStyle,
  type LiveDocDecoration,
  type LiveDocHeaderFooter,
  type LiveDocPageBorder,
  type LiveDocPageColumns,
  type LiveDocPageMargin,
  type LiveDocPageNumberStyle,
  type LiveDocPageOrientation,
  type LiveDocPageSetup,
  type LiveDocPageSize,
} from "./useLiveDoc";

const FRONT_MATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** Keys this module owns.  A leading `--- … ---` block is only treated as
 *  metadata when it carries at least one of these - otherwise it is left in
 *  the body, so a document that merely *starts* with a horizontal rule (`---`)
 *  is never mistaken for front matter and silently eaten. */
const KNOWN_KEYS = new Set([
  // Header / footer furniture.
  "header",
  "footer",
  "page-numbers",
  "header-style",
  "footer-style",
  // Page geometry + decoration ("layout").
  "page-size",
  "orientation",
  "margin",
  "margin-x",
  "margin-y",
  "columns",
  "border",
  "watermark",
]);

/** Double-quoted JSON strings are valid YAML scalars and handle all escaping. */
function yamlString(value: string): string {
  return JSON.stringify(value);
}

/** Document layout (page geometry + decoration) surfaced alongside the
 *  header/footer furniture in the front-matter block. */
export interface LiveDocLayoutMeta {
  readonly pageSetup: LiveDocPageSetup;
  readonly decoration: LiveDocDecoration;
}

/** Serialise the layout + header/footer/page-number settings as a YAML
 *  front-matter block, or "" when nothing needs to be written.
 *
 *  `layout` is optional so callers that only care about the header/footer
 *  furniture (and the existing tests) keep the original behaviour. */
export function serializeFrontMatter(hf: LiveDocHeaderFooter, layout?: LiveDocLayoutMeta): string {
  const lines: string[] = [];
  if (layout) {
    const { pageSetup: ps, decoration: deco } = layout;
    lines.push(`page-size: ${ps.size}`);
    lines.push(`orientation: ${ps.orientation}`);
    lines.push(`margin: ${ps.margin}`);
    if (typeof ps.marginX === "number") lines.push(`margin-x: ${Math.round(ps.marginX)}`);
    if (typeof ps.marginY === "number") lines.push(`margin-y: ${Math.round(ps.marginY)}`);
    lines.push(`columns: ${ps.columns ?? 1}`);
    if (deco.border !== "none") lines.push(`border: ${deco.border}`);
    if (deco.watermark.trim()) lines.push(`watermark: ${yamlString(deco.watermark)}`);
  }
  if (hf.headerEnabled) {
    lines.push(`header: ${yamlString(hf.header)}`);
    if (hf.headerStyle !== "blank") lines.push(`header-style: ${hf.headerStyle}`);
  }
  if (hf.footerEnabled) {
    lines.push(`footer: ${yamlString(hf.footer)}`);
    if (hf.footerStyle !== "blank") lines.push(`footer-style: ${hf.footerStyle}`);
  }
  if (hf.showPageNumber) {
    lines.push(`page-numbers: ${hf.pageNumberStyle}`);
  }
  if (lines.length === 0) return "";
  return `---\n${lines.join("\n")}\n---\n\n`;
}

function parseScalar(raw: string): string {
  const v = raw.trim();
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) {
    try {
      return JSON.parse(v) as string;
    } catch {
      return v.slice(1, -1);
    }
  }
  if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) return v.slice(1, -1);
  return v;
}

function asBandStyle(value: string): LiveDocBandStyle {
  return (BAND_STYLES as readonly string[]).includes(value) ? (value as LiveDocBandStyle) : "blank";
}

function asPageNumberStyle(value: string): LiveDocPageNumberStyle {
  return (PAGE_NUMBER_STYLES as readonly string[]).includes(value)
    ? (value as LiveDocPageNumberStyle)
    : "page-of";
}

function asPageSize(value: string): LiveDocPageSize | undefined {
  return value === "a4" || value === "letter" || value === "legal" ? value : undefined;
}
function asOrientation(value: string): LiveDocPageOrientation | undefined {
  return value === "portrait" || value === "landscape" ? value : undefined;
}
function asMargin(value: string): LiveDocPageMargin | undefined {
  return ["normal", "narrow", "moderate", "wide", "mirrored"].includes(value)
    ? (value as LiveDocPageMargin)
    : undefined;
}
function asColumns(value: string): LiveDocPageColumns | undefined {
  const n = Number(value);
  return n === 1 || n === 2 || n === 3 ? (n as LiveDocPageColumns) : undefined;
}
function asBorder(value: string): LiveDocPageBorder | undefined {
  return value === "none" || value === "thin" || value === "medium" ? value : undefined;
}
function asPx(value: string): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export interface ParsedFrontMatter {
  /** The header/footer settings patch, or `null` when no block was present. */
  readonly patch: Partial<LiveDocHeaderFooter> | null;
  /** The page-geometry patch, or `null` when no geometry key was present. */
  readonly pageSetup: Partial<LiveDocPageSetup> | null;
  /** The page-decoration patch, or `null` when no decoration key was present. */
  readonly decoration: Partial<LiveDocDecoration> | null;
  /** The markdown body with the front-matter block stripped. */
  readonly body: string;
}

/** Pull a leading YAML front-matter block (if any) off `text` and turn it into
 *  header/footer + layout patches.  Returns all-`null` patches when there is no
 *  block. */
export function parseFrontMatter(text: string): ParsedFrontMatter {
  const m = FRONT_MATTER_RE.exec(text);
  if (!m) return { patch: null, pageSetup: null, decoration: null, body: text };

  const fields = new Map<string, string>();
  for (const line of m[1].split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    if (key) fields.set(key, parseScalar(line.slice(idx + 1)));
  }

  // Only our own metadata block counts; otherwise leave the text untouched so
  // a stray leading `---` rule (or unrelated YAML) is never eaten.
  let hasKnown = false;
  for (const key of fields.keys()) {
    if (KNOWN_KEYS.has(key)) {
      hasKnown = true;
      break;
    }
  }
  if (!hasKnown) return { patch: null, pageSetup: null, decoration: null, body: text };

  // --- Header / footer furniture (presence-driven toggles) ----------------
  const headerEnabled = fields.has("header");
  const footerEnabled = fields.has("footer");
  const pageNumbersRaw = fields.get("page-numbers");
  const showPageNumber =
    pageNumbersRaw !== undefined && pageNumbersRaw !== "" && pageNumbersRaw.toLowerCase() !== "false";

  const patch: { -readonly [K in keyof LiveDocHeaderFooter]?: LiveDocHeaderFooter[K] } = {
    headerEnabled,
    footerEnabled,
    showPageNumber,
  };
  if (headerEnabled) {
    patch.header = fields.get("header") ?? "";
    const hs = fields.get("header-style");
    if (hs) patch.headerStyle = asBandStyle(hs);
  }
  if (footerEnabled) {
    patch.footer = fields.get("footer") ?? "";
    const fs = fields.get("footer-style");
    if (fs) patch.footerStyle = asBandStyle(fs);
  }
  if (showPageNumber && pageNumbersRaw) {
    patch.pageNumberStyle =
      pageNumbersRaw.toLowerCase() === "true" ? "page-of" : asPageNumberStyle(pageNumbersRaw);
  }

  // --- Page geometry (value-driven patches) -------------------------------
  const pageSetup: { -readonly [K in keyof LiveDocPageSetup]?: LiveDocPageSetup[K] } = {};
  const sizeRaw = fields.get("page-size");
  if (sizeRaw !== undefined) {
    const s = asPageSize(sizeRaw);
    if (s) pageSetup.size = s;
  }
  const orientRaw = fields.get("orientation");
  if (orientRaw !== undefined) {
    const o = asOrientation(orientRaw);
    if (o) pageSetup.orientation = o;
  }
  const marginRaw = fields.get("margin");
  if (marginRaw !== undefined) {
    const mg = asMargin(marginRaw);
    if (mg) pageSetup.margin = mg;
  }
  const marginXRaw = fields.get("margin-x");
  if (marginXRaw !== undefined) {
    const mx = asPx(marginXRaw);
    if (mx !== undefined) pageSetup.marginX = mx;
  }
  const marginYRaw = fields.get("margin-y");
  if (marginYRaw !== undefined) {
    const my = asPx(marginYRaw);
    if (my !== undefined) pageSetup.marginY = my;
  }
  const columnsRaw = fields.get("columns");
  if (columnsRaw !== undefined) {
    const c = asColumns(columnsRaw);
    if (c) pageSetup.columns = c;
  }

  // --- Page decoration (value-driven patches) -----------------------------
  const decoration: { -readonly [K in keyof LiveDocDecoration]?: LiveDocDecoration[K] } = {};
  const borderRaw = fields.get("border");
  if (borderRaw !== undefined) {
    const b = asBorder(borderRaw);
    if (b) decoration.border = b;
  }
  const watermarkRaw = fields.get("watermark");
  if (watermarkRaw !== undefined) decoration.watermark = watermarkRaw;

  // Drop the single blank line that separates the metadata block from the body.
  const body = text.slice(m[0].length).replace(/^\r?\n/, "");
  return {
    patch,
    pageSetup: Object.keys(pageSetup).length ? pageSetup : null,
    decoration: Object.keys(decoration).length ? decoration : null,
    body,
  };
}
