/**
 * The app's colour themes, spoken in Nebula's surface language.
 *
 * A theme is a Standard stylesheet: a hundred-odd custom properties on `:root`
 * that Standard's CSS reads straight out of the cascade. Nebula paints from a
 * MUI theme built out of `NebulaTokens` instead, so the only thing a theme
 * could tell it was whether the window was light or dark - picking Rose or
 * Hearth moved one bit and left the pack navy.
 *
 * This module is the translation. It takes the dozen properties that carry a
 * theme's *identity* rather than its layout and derives the whole token set
 * from them, keeping Nebula's own structure: the alpha ladder its surfaces are
 * built from, the shapes of its gradients, and the contrast floors a colour has
 * to clear before it is allowed on screen. The colour changes; the design does
 * not.
 *
 * # Why the theme's glass, and not its surfaces
 *
 * Every theme writes a `--color-glass-*` ladder that already points the right
 * way for its own mode - a wash of light on a dark theme, a wash of ink on a
 * light one. Nebula takes the *hue* of that wash and re-applies its own alphas,
 * so a chip stays as faint as the mock drew it while carrying the theme's tint.
 * Taking the themes' alphas too would also "work", but the light themes' ladders
 * run two to three times heavier than Nebula's, and the pack would stop being
 * airy - which is most of what it is.
 *
 * # Dark and Light stay Nebula's own
 *
 * Those two are the app's neutral defaults, and the mock *is* Nebula's answer to
 * them: a navy scheme no theme file describes. Deriving them would repaint the
 * pack's identity for every user who never chose a theme at all, so they keep
 * the mock's tokens and the other nine derive. Choosing Dark in Nebula is how
 * you ask for Nebula's own colours.
 */
import { over, withAlpha } from "@shared/profilecard";
import { CONTRAST_ACCENT, clamp, contrast, fromHsl, parseHex, toHex, toHsl } from "./livery";
import { NEBULA_TOKENS, type NebulaMode, type NebulaTokens } from "./tokens";

/**
 * The theme properties Nebula reads, and what each one is for.
 *
 * Deliberately short. Every property added here is one a future theme has to
 * define to look right, and the ones below are the ones all seventeen bundled
 * theme files already agree on.
 */
export const THEME_VARIABLES = {
  /** The window's own colour; also what decides light from dark. */
  bg: "--color-bg-primary",
  /** The opaque raised surface a light scheme puts cards on. */
  surface: "--color-surface",
  text: "--color-text-primary",
  textSecondary: "--color-text-secondary",
  textMuted: "--color-text-muted",
  accent: "--color-accent",
  /** The theme's second hue, which is what keeps a tint from being monochrome. */
  purple: "--color-purple",
  online: "--color-online",
  warning: "--color-warning",
  danger: "--color-danger",
  /** The tint of a raised wash - hue only, see the module note. */
  glass: "--color-glass-medium",
  /** The tint of a hairline, which several themes deliberately differ on. */
  glassLine: "--color-glass-border",
} as const;

export type ThemeVars = Record<keyof typeof THEME_VARIABLES, string>;

/**
 * Themes whose colours Nebula does not derive, because it already has an
 * opinion about them. See the module note.
 */
export const NATIVE_THEME_IDS: ReadonlySet<string> = new Set(["dark", "light"]);

/** Body text. WCAG's floor for normal-sized text. */
const CONTRAST_TEXT = 4.5;
/** Captions and labels: read, but not read for long. */
const CONTRAST_MUTED = 3;
/** Section headers and timestamps - noticed rather than read. */
const CONTRAST_DIM = 2.2;

/**
 * Read the applied theme's properties off an element, or null when no theme
 * stylesheet has taken effect yet.
 *
 * Custom properties come back as authored rather than resolved, so what lands
 * here is the theme file's own notation - `#1a0f14` and `rgba(255, 200, 220,
 * 0.05)` - which is what everything below is written to take apart.
 */
export function readThemeVars(root?: Element): ThemeVars | null {
  if (typeof globalThis.getComputedStyle !== "function") return null;
  const style = globalThis.getComputedStyle(root ?? document.documentElement);
  const vars = Object.fromEntries(
    Object.entries(THEME_VARIABLES).map(([key, property]) => [key, style.getPropertyValue(property).trim()]),
  ) as ThemeVars;
  // The window colour is the one property nothing below can be derived without,
  // and its absence is exactly the state before the stylesheet applies.
  return vars.bg ? vars : null;
}

/**
 * The tokens Nebula should paint with for the theme now on `<html>`.
 *
 * The single entry point: it knows which themes are the pack's own and which
 * derive, so callers only have to hand over what they read.
 */
export function nebulaTokensForTheme(
  themeId: string | null,
  mode: NebulaMode,
  vars: ThemeVars | null,
): NebulaTokens {
  if (!vars || themeId === null || NATIVE_THEME_IDS.has(themeId)) return NEBULA_TOKENS[mode];
  return deriveNebulaTokens(mode, vars);
}

/** Flatten a theme colour onto the window and hand back opaque `#rrggbb`. */
function flatten(value: string, base: string, fallback: string): string {
  if (!value) return fallback;
  const flat = over(value, base);
  return /^#[0-9a-f]{6}$/i.test(flat) ? flat.toLowerCase() : fallback;
}

/** A colour moved, hue intact, until it clears `target` against the window. */
function readable(colour: string, behind: string, target: number): string {
  const wanted = parseHex(colour);
  const ground = parseHex(behind);
  if (!wanted || !ground) return colour;
  return toHex(clamp(wanted, ground, target));
}

/** The same colour, `delta` lighter (or darker) - the ends of a gradient. */
function shift(colour: string, delta: number): string {
  const parsed = parseHex(colour);
  if (!parsed) return colour;
  const [hue, saturation, lightness] = toHsl(parsed);
  return toHex(fromHsl(hue, saturation, Math.min(1, Math.max(0, lightness + delta))));
}

/** Halfway between two colours, for the gradient blob that sits between them. */
function blend(one: string, other: string): string {
  const first = parseHex(one);
  const second = parseHex(other);
  if (!first || !second) return one;
  return toHex(
    first.map((channel, at) => Math.round((channel + second[at]) / 2)) as [number, number, number],
  );
}

/**
 * Ink for the one filled element on a surface.
 *
 * Computed against the accent that survived the contrast floor rather than
 * taken from `--color-text-on-accent`, which the theme chose to pair with the
 * accent it *wrote*. A yellow accent on a light theme is darkened several steps
 * before it reaches a button, and the theme's white ink would follow it down.
 *
 * Both candidates are tinted by the window rather than being pure black and
 * white, which is the same thing the mock's own `onAccent` is - a near-black
 * carrying the scheme's hue, not `#000`.
 */
function inkOn(accent: string, bg0: string): string {
  const face = parseHex(accent);
  const ground = parseHex(bg0);
  if (!face || !ground) return accent;
  const [hue, saturation] = toHsl(ground);
  const dark = fromHsl(hue, Math.min(saturation, 0.45), 0.09);
  const light = fromHsl(hue, Math.min(saturation, 0.12), 0.97);
  return toHex(contrast(face, dark) >= contrast(face, light) ? dark : light);
}

/**
 * Nebula's tokens for one theme.
 *
 * Every fallback is the mock's own value for this mode, so a theme that omits a
 * property loses that one colour and nothing else - the same rule livery
 * follows, and the reason neither needs a "themed?" switch.
 */
export function deriveNebulaTokens(mode: NebulaMode, vars: ThemeVars): NebulaTokens {
  const mock = NEBULA_TOKENS[mode];
  const dark = mode === "dark";

  const bg0 = flatten(vars.bg, "#000000", mock.bg0);

  // Hue carriers, kept as authored: `withAlpha` re-alphas them in place, so a
  // theme that tinted its glass pink hands Nebula a pink chip at Nebula's own
  // faintness rather than at the theme's.
  const glass = over(vars.glass, bg0).startsWith("#") ? vars.glass : mock.card;
  const glassLine = over(vars.glassLine, bg0).startsWith("#") ? vars.glassLine : glass;

  const accent = readable(flatten(vars.accent, bg0, mock.accent), bg0, CONTRAST_ACCENT);
  // The wash gradients use the accent as written, not as clamped: a glow at 20%
  // alpha behind a panel is not something anybody reads, and holding it to a
  // text floor would flatten every theme's mood towards its own background.
  const glow = flatten(vars.accent, bg0, mock.accent);
  const second = flatten(vars.purple, bg0, glow);

  return {
    bg0,
    panel: dark ? withAlpha(glass, 0.05) : withAlpha(bg0, 0.6),
    // A dark scheme raises a card with light it lets the wallpaper through;
    // a light one raises it by being opaque and brighter than the window. Both
    // are what the mock does, and both are what every theme's own `--color-
    // surface` says for its mode.
    card: dark ? withAlpha(glass, 0.1) : flatten(vars.surface, bg0, mock.card),
    card2: withAlpha(glass, dark ? 0.17 : 0.06),
    line: withAlpha(glassLine, dark ? 0.07 : 0.055),
    line2: withAlpha(glassLine, dark ? 0.17 : 0.12),
    hover: withAlpha(glass, dark ? 0.12 : 0.05),
    text: readable(flatten(vars.text, bg0, mock.text), bg0, CONTRAST_TEXT),
    muted: readable(flatten(vars.textSecondary, bg0, mock.muted), bg0, CONTRAST_MUTED),
    dim: readable(flatten(vars.textMuted, bg0, mock.dim), bg0, CONTRAST_DIM),
    // Glass floating over a wallpaper stays neutral in both schemes - a tinted
    // wash there reads as a coloured slab rather than as glass, which is the
    // note already on `wash` in `tokens.ts`. Only the hairline picks up the
    // theme, and only where the mock's own does.
    wash: mock.wash,
    washLine: dark ? mock.washLine : withAlpha(glassLine, 0.14),
    accent,
    onAccent: inkOn(accent, bg0),
    accentSoft: withAlpha(accent, dark ? 0.22 : 0.14),
    accentLine: withAlpha(accent, dark ? 0.38 : 0.34),
    ok: readable(flatten(vars.online, bg0, mock.ok), bg0, CONTRAST_ACCENT),
    bad: readable(flatten(vars.danger, bg0, mock.bad), bg0, CONTRAST_ACCENT),
    warn: readable(flatten(vars.warning, bg0, mock.warn), bg0, CONTRAST_ACCENT),
    shadow: dark
      ? `0 30px 80px ${withAlpha(shift(bg0, -0.1), 0.6)}`
      : `0 30px 60px ${withAlpha(glassLine, 0.18)}`,
    tint: tintOf(glow, second, dark),
    backdrop: backdropOf(bg0, glow, second, dark),

    // The chrome slots the design sheet introduced. A Standard stylesheet has
    // nothing to say about a server rail or a title bar, so each of these
    // resolves to the surface the pack drew before they existed - which is
    // exactly what this path is for: a theme the sheet does not draw still
    // looks like Nebula, in that theme's colours.
    window: "none",
    bar: dark ? withAlpha(glass, 0.05) : withAlpha(bg0, 0.6),
    barText: readable(flatten(vars.text, bg0, mock.text), bg0, CONTRAST_TEXT),
    barDim: readable(flatten(vars.textSecondary, bg0, mock.muted), bg0, CONTRAST_MUTED),
    barFaint: readable(flatten(vars.textMuted, bg0, mock.dim), bg0, CONTRAST_DIM),
    header: dark ? withAlpha(glass, 0.05) : withAlpha(bg0, 0.6),
    cardEdge: over(dark ? withAlpha(glass, 0.1) : flatten(vars.surface, bg0, mock.card), bg0),
    input: withAlpha(glass, dark ? 0.17 : 0.06),
    tile: withAlpha(glass, dark ? 0.17 : 0.06),
    accentText: accent,
    accent2: second,
    accentOnRail: accent,
    rail: dark ? withAlpha(glass, 0.05) : withAlpha(bg0, 0.6),
    railEdge: bg0,
    railText: readable(flatten(vars.textSecondary, bg0, mock.muted), bg0, CONTRAST_MUTED),
    railDim: readable(flatten(vars.textMuted, bg0, mock.dim), bg0, CONTRAST_DIM),
    railTile: withAlpha(glass, dark ? 0.17 : 0.06),
    railLine: withAlpha(glassLine, dark ? 0.07 : 0.055),
    gifBg: withAlpha(glass, dark ? 0.17 : 0.06),
    gifText: readable(flatten(vars.textSecondary, bg0, mock.muted), bg0, CONTRAST_MUTED),
  };
}

/**
 * The radial wash a floating surface lays over the window colour.
 *
 * The geometry is the mock's, unchanged: two blobs anchored off opposite
 * corners, plus a third in a dark scheme that keeps the middle of a tall menu
 * from going flat. Only the two colours come from the theme.
 */
function tintOf(glow: string, second: string, dark: boolean): string {
  const stops = [
    `radial-gradient(1100px 500px at 22% -6%,${withAlpha(glow, dark ? 0.22 : 0.11)},transparent 58%)`,
    `radial-gradient(900px 560px at 102% 108%,${withAlpha(second, dark ? 0.15 : 0.07)},transparent 62%)`,
  ];
  if (dark) stops.push(`radial-gradient(700px 400px at 60% 40%,${withAlpha(glow, 0.04)},transparent 65%)`);
  return stops.join(",");
}

/**
 * The textured wash behind the conversation.
 *
 * Busier than the tint on purpose: the channel header and the composer blur
 * what is behind them, and a smooth gradient blurs to something identical to
 * itself. The overlapping blobs at four scales are what give that chrome
 * something to be glass *over*, so the count and the placement are structural -
 * only the colours are the theme's.
 */
function backdropOf(bg0: string, glow: string, second: string, dark: boolean): string {
  const [near, far, mid, small] = dark ? [0.2, 0.18, 0.16, 0.1] : [0.14, 0.12, 0.1, 0.08];
  return [
    `radial-gradient(680px 420px at 12% 8%,${withAlpha(glow, near)},transparent 62%)`,
    `radial-gradient(520px 520px at 78% 18%,${withAlpha(second, far)},transparent 60%)`,
    `radial-gradient(760px 460px at 62% 92%,${withAlpha(blend(glow, second), mid)},transparent 64%)`,
    `radial-gradient(340px 340px at 34% 62%,${withAlpha(glow, small)},transparent 66%)`,
    dark
      ? `linear-gradient(160deg,${withAlpha(shift(bg0, 0.12), 0.55)},${withAlpha(shift(bg0, -0.03), 0.55)})`
      : `linear-gradient(160deg,rgba(255,255,255,.5),${withAlpha(shift(bg0, -0.05), 0.5)})`,
  ].join(",");
}
