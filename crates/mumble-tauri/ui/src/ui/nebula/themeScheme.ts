/**
 * A design-sheet theme, resolved into the tokens the pack paints with.
 *
 * A port of the sheet's own `build()`, kept deliberately literal: the same
 * fallback chain, the same alphas, the same order. Where the sheet computes a
 * value (`pan()`, `accentSoft`, the canvas gradient) this computes the same one,
 * so a colour on screen can be traced back to a line in `themeCatalog.ts`
 * without a translation step in between.
 *
 * Two things the sheet leaves to the app, because its mock never draws them:
 *
 * - **Destructive and caution.** A palette states them when it has an opinion
 *   (Ply reserves red, Mobel and Midnight name their alert hue); otherwise the
 *   pack's own are used, moved until they clear the theme's window.
 * - **Menus, dialogs and the wallpaper glass.** `tint`, `wash` and `shadow`
 *   belong to surfaces the sheet has no artboard for, so they are built from the
 *   theme's accent and window rather than invented per theme.
 */
import { over, withAlpha } from "@shared/profilecard";
import { CONTRAST_ACCENT, clamp, fromHsl, parseHex, toHex, toHsl } from "./livery";
import { nebulaThemeDef, type NebulaPalette, type NebulaSkin, type NebulaThemeDef } from "./themeCatalog";
import type { NebulaMode, NebulaTokens } from "./tokens";

/** Everything one theme in one mode says about how the pack looks. */
export interface NebulaScheme {
  id: string;
  name: string;
  mode: NebulaMode;
  tokens: NebulaTokens;
  skin: NebulaSkin;
}

/** The pack's own destructive and caution hues, before the contrast clamp. */
const FALLBACK_DANGER = { dark: "#f57e7e", light: "#d05e5e" } as const;
const FALLBACK_WARNING = { dark: "#ecba55", light: "#aa8138" } as const;
const FALLBACK_ONLINE = "#38b878";

/** `#rrggbb` at an alpha - the sheet's `a()`. */
function alpha(hex: string, value: number): string {
  return withAlpha(hex, value);
}

/** A colour moved, hue intact, until it clears `target` against `behind`. */
function readable(colour: string, behind: string, target = CONTRAST_ACCENT): string {
  const wanted = parseHex(colour);
  const ground = parseHex(behind);
  if (!wanted || !ground) return colour;
  return toHex(clamp(wanted, ground, target));
}

/** The same colour, `delta` lighter or darker. */
function shift(colour: string, delta: number): string {
  const parsed = parseHex(colour);
  if (!parsed) return colour;
  const [hue, saturation, lightness] = toHsl(parsed);
  return toHex(fromHsl(hue, saturation, Math.min(1, Math.max(0, lightness + delta))));
}

/**
 * A background value that is safe to stack another layer under.
 *
 * Several palettes give a flat colour where others give a mesh (`windowBg:
 * "#ffffff"` in Ply). Only the last layer of a `background` shorthand may carry
 * a colour, so a flat one is wrapped into a gradient that paints the same thing
 * and can sit anywhere in the stack.
 */
function layerable(value: string): string {
  if (!value || value === "none") return "none";
  return value.includes("gradient(") ? value : `linear-gradient(${value},${value})`;
}

/**
 * The overlay texture, with its own opacity multiplied into it.
 *
 * The sheet paints scanlines in a separate element at `overlayOpacity`; the pack
 * composes one `backdrop` string instead, so the opacity has to ride inside the
 * colour stops. Only the alpha changes - the geometry of the repeat is the
 * sheet's.
 */
function bakedOverlay(overlay: string | undefined, opacity: number): string | null {
  if (!overlay) return null;
  if (opacity >= 1) return overlay;
  return overlay.replace(
    /rgba\(([^,]+),([^,]+),([^,]+),([^)]+)\)/g,
    (_, red: string, green: string, blue: string, existing: string) =>
      `rgba(${red.trim()},${green.trim()},${blue.trim()},${(Number.parseFloat(existing) * opacity).toFixed(3)})`,
  );
}

/**
 * Resolve one palette into the pack's tokens.
 *
 * Exported for the tests and the preview page; the app goes through
 * `nebulaScheme` below, which finds the definition first.
 */
export function schemeTokens(palette: NebulaPalette, skin: NebulaSkin, mode: NebulaMode): NebulaTokens {
  const c = palette;
  const glass = skin.glass;
  // The sheet's `pan()`: chrome is the stated colour at `1 - glass`, so one
  // number moves every panel from opaque to heavy glass at once.
  const pan = (hex: string) => (glass ? alpha(hex, 1 - glass) : hex);

  const bg0 = c.app;
  const surface = c.surface;
  const cardEdge = c.card ?? surface;
  const border = glass ? alpha(c.border, 0.7) : c.border;
  const accent = c.accent;
  const accentText = c.accentFg ?? c.accent;
  const dark = mode === "dark";

  const canvas = `linear-gradient(165deg, ${c.canvasA} 0%, ${c.canvasB} 100%)`;
  const overlay = bakedOverlay(c.overlay, c.overlayOpacity ?? 1);

  return {
    bg0,
    window: layerable(c.windowBg ?? "none"),

    // Chrome. Each of these is a separate statement in the sheet, and the
    // themes that invert one against the window - Midnight's black bar, Mobel
    // and Ply's ink rail - are exactly why they are not one token.
    bar: pan(c.bar ?? c.app),
    barText: c.barFg ?? c.text,
    barDim: c.barDim ?? c.dim,
    barFaint: c.barFaint ?? c.faint,
    panel: pan(c.side),
    header: pan(c.header ?? surface),
    rail: pan(c.rail),
    railEdge: c.rail,
    railText: c.railFg,
    railDim: c.railDim,
    railTile: c.railTile,
    railLine: c.railBorder ?? border,

    // Surfaces.
    card: pan(c.card ?? surface),
    cardEdge,
    card2: c.chip,
    input: pan(c.input),
    tile: c.tile,
    // The sheet draws one hairline. The pack draws two - a section rule and a
    // card edge - so the lighter of the pair is the stated border stepped back
    // rather than a second colour the sheet never chose.
    line: alpha(c.border, glass ? 0.35 : 0.5),
    line2: border,
    hover: alpha(c.text, dark ? 0.07 : 0.05),

    text: c.text,
    muted: c.dim,
    dim: c.faint,

    accent,
    accentText,
    accent2: c.accent2,
    accentOnRail: c.accentOnRail ?? accent,
    onAccent: c.onAccent ?? "#ffffff",
    accentSoft: alpha(accent, 0.2),
    accentLine: alpha(accentText, 0.4),

    ok: c.online ?? FALLBACK_ONLINE,
    bad: readable(c.danger ?? FALLBACK_DANGER[mode], bg0),
    warn: readable(c.warning ?? FALLBACK_WARNING[mode], bg0),

    gifBg: c.gifBg ?? c.chip,
    gifText: c.gifFg ?? c.dim,

    // The conversation: the theme's gradient, its veil, and any texture over
    // the pair. Composed into one value so every surface that already reads
    // `backdrop` picks the whole thing up untouched.
    backdrop: [overlay, c.wash, canvas].filter(Boolean).join(","),

    // Surfaces the sheet has no artboard for.
    tint: [
      `radial-gradient(1100px 500px at 22% -6%,${alpha(accent, dark ? 0.18 : 0.09)},transparent 58%)`,
      `radial-gradient(900px 560px at 102% 108%,${alpha(c.accent2, dark ? 0.13 : 0.06)},transparent 62%)`,
    ].join(","),
    wash: dark ? "rgba(255,255,255,.06)" : "rgba(255,255,255,.55)",
    washLine: alpha(c.border, dark ? 0.4 : 0.6),
    shadow: dark
      ? `0 30px 80px ${alpha(shift(bg0, -0.1), 0.6)}`
      : `0 30px 60px ${alpha(shift(c.border, -0.25), 0.22)}`,
  };
}

/** Both schemes for one definition, keyed by mode. */
export function schemesFor(def: NebulaThemeDef): Record<NebulaMode, NebulaScheme> {
  return {
    light: {
      id: def.id,
      name: def.name,
      mode: "light",
      skin: def.skin,
      tokens: schemeTokens(def.light, def.skin, "light"),
    },
    dark: {
      id: def.id,
      name: def.name,
      mode: "dark",
      skin: def.skin,
      tokens: schemeTokens(def.dark, def.skin, "dark"),
    },
  };
}

/**
 * The scheme for a theme id in a mode, or null when the sheet does not draw it.
 *
 * `null` is the whole of the fallback path: a colour theme that predates the
 * sheet, or one added to Standard since, keeps working through the CSS
 * derivation in `themeTokens.ts`.
 */
export function nebulaScheme(themeId: string | null | undefined, mode: NebulaMode): NebulaScheme | null {
  const def = nebulaThemeDef(themeId);
  if (!def) return null;
  const palette = mode === "dark" ? def.dark : def.light;
  return { id: def.id, name: def.name, mode, skin: def.skin, tokens: schemeTokens(palette, def.skin, mode) };
}

/** A swatch strip for the picker: the four colours that identify a theme. */
export function schemeSwatches(scheme: NebulaScheme): string[] {
  const { tokens } = scheme;
  return [tokens.bg0, over(tokens.card, tokens.bg0), tokens.accent, tokens.accent2];
}
