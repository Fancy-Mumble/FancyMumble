/** HSL colour representation (h: 0-360, s: 0-100, l: 0-100). */
export interface HSL {
  h: number;
  s: number;
  l: number;
}

export function hexToHsl(hex: string): HSL {
  const raw = hex.replace("#", "");
  const r = parseInt(raw.substring(0, 2), 16) / 255;
  const g = parseInt(raw.substring(2, 4), 16) / 255;
  const b = parseInt(raw.substring(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }

  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function hslToHex(hsl: HSL): string {
  const h = hsl.h / 360;
  const s = hsl.s / 100;
  const l = hsl.l / 100;

  if (s === 0) {
    const v = Math.round(l * 255);
    return `#${v.toString(16).padStart(2, "0").repeat(3)}`;
  }

  const hue2rgb = (p: number, q: number, t: number) => {
    const tt = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = Math.round(hue2rgb(p, q, h + 1 / 3) * 255);
  const g = Math.round(hue2rgb(p, q, h) * 255);
  const b = Math.round(hue2rgb(p, q, h - 1 / 3) * 255);

  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

/** sRGB relative luminance of any colour `parseColor` can take apart; null otherwise. */
function relativeLuminance(color: string): number | null {
  const parsed = parseColor(color);
  if (!parsed) return null;
  const toLinear = (c: number) => {
    const srgb = c / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * toLinear(parsed.r) + 0.7152 * toLinear(parsed.g) + 0.0722 * toLinear(parsed.b);
}

/**
 * Choose a text colour (light or dark) that has the best perceived
 * contrast against the given background hex, using the APCA model.
 */
export function textColorForBg(bgHex: string): string {
  return textColorForGradient([bgHex]);
}

/**
 * Given user-selected colours, generate harmonious companion colours
 * to fill a visually pleasing palette. Uses analogous hue shifts and
 * lightness / saturation variations derived from the input set.
 */
export function generateHarmoniousColors(userColors: string[]): string[] {
  if (userColors.length === 0) return [];
  const hslColors = userColors.map(hexToHsl);

  const avgH = averageHue(hslColors);
  const avgS = Math.round(hslColors.reduce((sum, c) => sum + c.s, 0) / hslColors.length);
  const avgL = Math.round(hslColors.reduce((sum, c) => sum + c.l, 0) / hslColors.length);

  const companions: string[] = [];

  companions.push(
    hslToHex({ h: (avgH + 30) % 360, s: clamp(avgS - 10, 15, 90), l: clamp(avgL - 8, 10, 85) }),
  );
  companions.push(
    hslToHex({ h: (avgH + 330) % 360, s: clamp(avgS - 5, 15, 90), l: clamp(avgL + 8, 10, 85) }),
  );
  companions.push(
    hslToHex({ h: (avgH + 15) % 360, s: clamp(avgS + 10, 15, 90), l: clamp(avgL - 15, 10, 85) }),
  );

  return companions;
}

/**
 * Compute a border colour that complements the gradient.
 * Picks a slightly lighter, more saturated variation of the average hue.
 */
export function borderColorFromPalette(userColors: string[]): string {
  if (userColors.length === 0) return "rgba(255,255,255,0.12)";
  const hslColors = userColors.map(hexToHsl);
  const avgH = averageHue(hslColors);
  const avgS = Math.round(hslColors.reduce((sum, c) => sum + c.s, 0) / hslColors.length);
  const avgL = Math.round(hslColors.reduce((sum, c) => sum + c.l, 0) / hslColors.length);
  return hslToHex({ h: avgH, s: clamp(avgS + 15, 20, 80), l: clamp(avgL + 20, 30, 70) });
}

/**
 * Compute APCA (Advanced Perceptual Contrast Algorithm) lightness
 * contrast between a background and text colour.
 *
 * Returns a signed value: positive = dark text on light bg,
 * negative = light text on dark bg. Higher absolute value = better
 * perceived readability. APCA properly accounts for the polarity
 * asymmetry where light text on dark/saturated backgrounds is more
 * legible than the reverse at equal luminance differences.
 */
function apcaLightness(bgY: number, txtY: number): number {
  const bgC = bgY > 0.022 ? bgY : bgY + (0.022 - bgY) ** 1.414;
  const txtC = txtY > 0.022 ? txtY : txtY + (0.022 - txtY) ** 1.414;

  if (bgC > txtC) {
    const sapc = (bgC ** 0.56 - txtC ** 0.57) * 1.14;
    return sapc < 0.1 ? 0 : (sapc - 0.027) * 100;
  }
  const sapc = (bgC ** 0.65 - txtC ** 0.62) * 1.14;
  return sapc > -0.1 ? 0 : (sapc + 0.027) * 100;
}

/**
 * Find the best text colour for content placed over a gradient.
 *
 * Uses APCA (the contrast model for WCAG 3.0) which correctly handles
 * polarity: light text on saturated/dark backgrounds is perceived as
 * more readable than dark text at the same mathematical luminance
 * difference. This fixes issues with pure red, blue, and other
 * saturated mid-tone colours where WCAG 2.x picks dark text incorrectly.
 *
 * Evaluates both white and black text against every gradient stop,
 * takes the worst-case (minimum |Lc|) for each, and picks the winner.
 */
export function textColorForGradient(userColors: string[]): string {
  return inkForStops(userColors).ink;
}

export function hexToRgba(hex: string, alpha: number): string {
  const raw = hex.replace("#", "");
  const r = parseInt(raw.substring(0, 2), 16);
  const g = parseInt(raw.substring(2, 4), 16);
  const b = parseInt(raw.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Max colours used in the background gradient (the rest become accents). */
const MAX_GRADIENT_STOPS = 3;

/**
 * Build a CSS gradient with optional glass-level transparency.
 * Only the first 3 user colours are used as gradient stops; extras should
 * be consumed as accent / border colours via `resolveThemePalette`.
 */
export function buildGradient(userColors: string[], angle = 135, alpha = 1): string {
  if (userColors.length === 0) return "var(--color-glass)";
  const stops = gradientStops(userColors);
  const toStop = (c: string) => (alpha < 1 ? withAlpha(c, alpha) : c);
  return `linear-gradient(${angle}deg, ${stops.map(toStop).join(", ")})`;
}

/**
 * The stops a gradient is drawn through: the first three picks, or a single
 * pick and a companion a shade off it so one colour still reads as a rake.
 */
function gradientStops(userColors: string[]): string[] {
  const stops = userColors.slice(0, MAX_GRADIENT_STOPS);
  if (stops.length !== 1) return stops;
  const hsl = hexToHsl(stops[0]);
  const companion = hslToHex({
    h: hsl.h,
    s: clamp(hsl.s - 5, 10, 90),
    l: clamp(hsl.l + (hsl.l > 50 ? -12 : 12), 10, 85),
  });
  return [stops[0], companion];
}

export interface ThemePalette {
  gradient: string;
  /**
   * The gradient's stops, each pushed just far enough that `textColor` reads
   * on it. Hosts that rake the card at their own angle build from these.
   */
  stops: string[];
  borderColor: string;
  accentColor?: string;
  textColor: string;
}

/**
 * Derive a full theme palette from the user's colour picks.
 *
 * - Colours 1-3 form the background gradient.
 * - Colour 4 becomes the border accent (falls back to computed).
 * - Colour 5 becomes a general accent (status highlights, etc.).
 * - Text colour is always contrast-aware against the gradient colours - and
 *   where no ink could read on a pick (a white beside a black, a saturated
 *   mid-tone), the pick is deepened or lifted by the least amount that lets
 *   the text through, so no combination can leave the card unreadable.
 */
export function resolveThemePalette(userColors: string[], glass = false): ThemePalette {
  const alpha = glass ? 0.55 : 1;
  const gradientColors = userColors.slice(0, MAX_GRADIENT_STOPS);
  const extras = userColors.slice(MAX_GRADIENT_STOPS);
  const textColor = textColorForGradient(gradientColors);
  const stops = readableStops(gradientStops(userColors), textColor);

  return {
    gradient: buildGradient(stops, 135, alpha),
    stops,
    borderColor: extras[0] ?? borderColorFromPalette(gradientColors),
    accentColor: extras[1],
    textColor,
  };
}

/**
 * Generate a random set of 1-5 visually cohesive theme colours.
 *
 * Uses an analogous palette: all hues stay within a ~60 degree arc,
 * with gentle saturation and lightness variation so the result looks
 * harmonious rather than like a rainbow.
 */
export function randomThemeColors(): string[] {
  const count = 1 + Math.floor(Math.random() * 5);
  const baseHue = Math.floor(Math.random() * 360);
  const baseSat = 35 + Math.floor(Math.random() * 35);
  const baseLit = 25 + Math.floor(Math.random() * 25);
  const colors: string[] = [];
  for (let i = 0; i < count; i++) {
    const hueShift = (i / Math.max(count - 1, 1)) * 60 - 30;
    const hue = (baseHue + hueShift + Math.random() * 10 - 5 + 360) % 360;
    const sat = clamp(baseSat + (Math.random() * 20 - 10), 20, 80);
    const lit = clamp(baseLit + i * 6 + (Math.random() * 8 - 4), 15, 55);
    colors.push(hslToHex({ h: Math.round(hue), s: Math.round(sat), l: Math.round(lit) }));
  }
  return colors;
}

function averageHue(colors: HSL[]): number {
  let sinSum = 0;
  let cosSum = 0;
  for (const c of colors) {
    const rad = (c.h * Math.PI) / 180;
    sinSum += Math.sin(rad);
    cosSum += Math.cos(rad);
  }
  let avg = (Math.atan2(sinSum, cosSum) * 180) / Math.PI;
  if (avg < 0) avg += 360;
  return Math.round(avg);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Fade any CSS colour the profile format can hold.
 *
 * `hexToRgba` above only speaks hex, and the card fades colours that arrive
 * from three different places: hex out of a stored profile, `rgba(...)` out of
 * a host theme's tokens, and named colours out of a hand-written card
 * background. Anything this cannot take apart is returned untouched, which
 * leaves the surface opaque rather than dropping the colour entirely.
 */
export function withAlpha(color: string, alpha: number): string {
  const value = color.trim();
  if (value.startsWith("#")) {
    const raw = value.slice(1);
    const full =
      raw.length === 3 || raw.length === 4
        ? raw
            .split("")
            .map((digit) => digit + digit)
            .join("")
        : raw;
    if (full.length < 6) return value;
    return hexToRgba(`#${full.slice(0, 6)}`, alpha);
  }
  const functional = /^(rgba?|hsla?)\(([^)]+)\)$/i.exec(value);
  if (functional) {
    // Both legacy (comma) and modern (space + slash) syntaxes appear in the
    // theme tokens, so normalise on the parts before any existing alpha.
    const parts = functional[2]
      .split("/")[0]
      .split(/[\s,]+/)
      .filter(Boolean)
      .slice(0, 3);
    if (parts.length === 3) {
      const fn = functional[1].toLowerCase().replace(/a$/, "");
      return `${fn}a(${parts.join(", ")}, ${alpha})`;
    }
  }
  return value;
}

/** Take a colour apart into channels and an alpha; null for anything else. */
function parseColor(color: string): { r: number; g: number; b: number; a: number } | null {
  const value = color.trim();
  if (value.startsWith("#")) {
    const raw = value.slice(1);
    const full =
      raw.length === 3 || raw.length === 4
        ? raw
            .split("")
            .map((digit) => digit + digit)
            .join("")
        : raw;
    if (full.length < 6) return null;
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
      a: full.length >= 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1,
    };
  }
  const functional = /^rgba?\(([^)]+)\)$/i.exec(value);
  if (!functional) return null;
  const parts = functional[1]
    .split("/")
    .flatMap((part) => part.split(/[\s,]+/))
    .filter(Boolean);
  if (parts.length < 3) return null;
  const [r, g, b, a] = parts.map(Number);
  if ([r, g, b].some(Number.isNaN)) return null;
  return { r, g, b, a: parts.length > 3 && !Number.isNaN(a) ? a : 1 };
}

/**
 * Flatten a translucent colour onto an opaque one.
 *
 * A host's theme describes surfaces *inside* its window, so a raised surface is
 * usually a wash of light at low alpha over the window's own colour. A card
 * that floats has no window under it - it is over a photograph, a message list,
 * another panel - so handed that wash directly it turns into a pane of glass
 * and takes on whatever it happens to be covering. Compositing the wash onto
 * the window colour here gives the card the shade the host intended, as a flat
 * colour it can also draw a ring in.
 */
export function over(color: string, base: string): string {
  const top = parseColor(color);
  const bottom = parseColor(base);
  if (!top || !bottom) return color;
  const mix = (a: number, b: number) => Math.round(b + (a - b) * top.a);
  const hex = (value: number) => clamp(value, 0, 255).toString(16).padStart(2, "0");
  return `#${hex(mix(top.r, bottom.r))}${hex(mix(top.g, bottom.g))}${hex(mix(top.b, bottom.b))}`;
}

// --- Readability ----------------------------------------------------

/**
 * The APCA Lc each kind of mark on a card is held to.
 *
 * Body text wants 60. The muted rung is captions and labels, and 45 is the
 * floor for text that has to be read rather than merely noticed; the dim rung
 * is the last one, and 30 is the model's floor for anything that is text at
 * all. Accents are glyphs and short bold labels, and 45 is where a coloured
 * chip stops disappearing into a card of a neighbouring hue. These only ever
 * raise a colour: the host themes' own ramps clear them as drawn.
 */
export const READABLE_LC = { text: 60, muted: 45, dim: 30, accent: 45 } as const;

const LIGHT_INK = "#ffffff";
const DARK_INK = "#111111";
const WHITE = "#ffffff";
const BLACK = "#000000";

/** Perceived contrast of `fg` on `bg` as an unsigned APCA Lc; 0 if either cannot be parsed. */
export function contrastLc(bg: string, fg: string): number {
  const bgY = relativeLuminance(bg);
  const fgY = relativeLuminance(fg);
  if (bgY == null || fgY == null) return 0;
  return Math.abs(apcaLightness(bgY, fgY));
}

function parseable(stops: string[]): string[] {
  return stops.filter((stop) => relativeLuminance(stop) != null);
}

/** The contrast `fg` gets on the worst of `stops`. */
function worstLc(stops: string[], fg: string): number {
  return stops.reduce((worst, stop) => Math.min(worst, contrastLc(stop, fg)), Infinity);
}

/** `color` pulled toward `toward` by `t` in [0, 1], keeping `color`'s own alpha. */
function mix(color: string, toward: string, t: number): string {
  const mixed = over(withAlpha(toward, t), color);
  const alpha = parseColor(color)?.a ?? 1;
  return alpha < 1 ? withAlpha(mixed, alpha) : mixed;
}

/** The least `t` in [0, 1], in 2% steps, at which `ok` holds; 1 if never. */
function leastMix(ok: (t: number) => boolean): number {
  const STEPS = 50;
  for (let step = 0; step < STEPS; step += 1) if (ok(step / STEPS)) return step / STEPS;
  return 1;
}

/** Whether `ink` is a light colour, and so wants its surroundings dark. */
function isLight(ink: string): boolean {
  return (relativeLuminance(ink) ?? 1) > 0.18;
}

/**
 * Which of the two inks reads best across all of `stops`, and the contrast it
 * gets on the worst of them.
 *
 * APCA rather than WCAG 2.x because of polarity: light text on a saturated or
 * dark mid-tone is more legible than dark text at the same luminance gap, and
 * the WCAG ratio picks dark text on pure red and blue where it plainly should
 * not. White wins a tie.
 */
export function inkForStops(stops: string[]): { ink: string; lc: number } {
  const usable = parseable(stops);
  const light = worstLc(usable, LIGHT_INK);
  const dark = worstLc(usable, DARK_INK);
  return light >= dark ? { ink: LIGHT_INK, lc: light } : { ink: DARK_INK, lc: dark };
}

/**
 * Every stop deepened (under a light ink) or lifted (under a dark one) by the
 * least amount that lets `ink` reach `minLc` on it.
 *
 * A stop that already reads is returned as the very string it came in as, so
 * a palette that was fine is painted exactly as its owner picked it.
 */
export function readableStops(stops: string[], ink: string, minLc: number = READABLE_LC.text): string[] {
  const veil = isLight(ink) ? BLACK : WHITE;
  return stops.map((stop) => {
    if (relativeLuminance(stop) == null) return stop;
    const t = leastMix((mixed) => contrastLc(mix(stop, veil, mixed), ink) >= minLc);
    return t === 0 ? stop : mix(stop, veil, t);
  });
}

/**
 * `color` pulled toward `ink` until it reads on every stop.
 *
 * This is what a role colour, a badge tone or a chosen accent goes through
 * before it is drawn on the card: a teal on a green card comes out a deep
 * teal, or a pale one on a dark card - still recognisably the colour it was,
 * no longer lost in the surface. The bar is never set above what the ink
 * itself manages on these stops, so a surface that cannot give `minLc` to
 * anything gets the colour pulled nearly as far as the ink, and no further.
 */
export function readableOn(
  color: string,
  stops: string[],
  ink: string,
  minLc: number = READABLE_LC.accent,
): string {
  const usable = parseable(stops);
  if (usable.length === 0 || relativeLuminance(color) == null) return color;
  // A step under what the ink itself gets here: reaching the ink's own
  // contrast would take the colour all the way to the ink.
  const target = Math.min(minLc, worstLc(usable, ink) - 5);
  const t = leastMix((mixed) => worstLc(usable, mix(color, ink, mixed)) >= target);
  return t === 0 ? color : mix(color, ink, t);
}

/**
 * The alpha `ink` can be faded to, no lower than `floor`, while still reaching
 * `minLc` on every stop - the muted and dim rungs of a card's text ramp.
 */
export function readableAlpha(ink: string, stops: string[], minLc: number, floor: number): number {
  const usable = parseable(stops);
  if (usable.length === 0) return floor;
  const reads = (alpha: number) =>
    usable.every((stop) => contrastLc(stop, over(withAlpha(ink, alpha), stop)) >= minLc);
  for (let alpha = floor; alpha < 1; alpha = Math.round((alpha + 0.02) * 100) / 100) {
    if (reads(alpha)) return alpha;
  }
  return 1;
}

/**
 * The alpha of a black scrim, no lower than `floor`, under which white text
 * reaches `minLc` on every stop - the wash behind the banner's controls.
 */
export function scrimAlpha(stops: string[], minLc: number, floor: number): number {
  const usable = parseable(stops);
  if (usable.length === 0) return floor;
  for (let alpha = floor; alpha < 1; alpha = Math.round((alpha + 0.02) * 100) / 100) {
    if (usable.every((stop) => contrastLc(mix(stop, BLACK, alpha), WHITE) >= minLc)) return alpha;
  }
  return 1;
}

const CSS_COLOR = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi;

/**
 * Every colour that can be picked out of a CSS value - a flat colour, or the
 * stops of a hand-written gradient - in the order it appears.
 */
export function colorsIn(css: string): string[] {
  return parseable(css.match(CSS_COLOR) ?? []);
}

/** `css` with each colour `colorsIn` would find replaced through `swap`, in the same order. */
export function mapColorsIn(css: string, swap: (color: string, index: number) => string): string {
  let index = 0;
  return css.replace(CSS_COLOR, (color) => (relativeLuminance(color) == null ? color : swap(color, index++)));
}
