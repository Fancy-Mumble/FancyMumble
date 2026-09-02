/**
 * Server livery: the presentation an operator supplies, folded into the pack's
 * own tokens.
 *
 * The mock draws the connect screen three times and the three differ by *how
 * much* the server sent, not by whether branding is on. So nothing here is a
 * switch: every field is independently optional, and what is absent leaves the
 * pack's own value exactly as it was. That is what makes "banner only, app
 * colours" - the middle rung, and the one most servers will sit on - fall out
 * of the same code path as a server that replaces the whole palette.
 *
 * # What a server is not allowed to do
 *
 * A livery arrives from a party that, before authentication, has proven
 * nothing. The rules are therefore about what is *inexpressible* rather than
 * what gets filtered:
 *
 * - **No string reaches CSS.** A colour is parsed to three integers here and
 *   re-serialised by us. `red;background:url(...)` cannot be expressed, because
 *   nothing a server sends survives as text.
 * - **Nothing here holds a URL a viewer fetches.** Artwork arrives as bytes the
 *   Rust side already pulled over the connection the client made; a server
 *   cannot turn a server-list browse into a beacon.
 * - **A contrast floor.** Every accepted colour is clamped against the surface
 *   it lands on, so a server can choose a mood but cannot make its own Connect
 *   button invisible - and cannot do it on only some viewers' themes.
 */
import type { NebulaMode, NebulaTokens } from "./tokens";

/** How a chip is toned. Not a colour: see `LiveryTag`. */
export type LiveryTone = "NEUTRAL" | "OK" | "WARN" | "BAD" | "ACCENT";

/**
 * One chip beside the server's name.
 *
 * Toned rather than coloured. A per-tag hex would be a second unclamped colour
 * channel, it would clash with whichever of the app's themes the viewer picked,
 * and the tone maps onto the `StatChip` tone this pack already has.
 */
export interface LiveryTag {
  label: string;
  tone: LiveryTone;
  /** `https://` only, opened externally. Absent for a chip that is not a link. */
  href?: string;
}

/** Colours a server offers for one mode. Every entry independently optional. */
export interface LiveryPalette {
  accent?: string;
  surface?: string;
  auraFrom?: string;
  auraTo?: string;
}

/** A server's livery, as the client holds it. */
export interface ServerLivery {
  /** Bumped by the server on every accepted change; the memo key. */
  version: number;
  /**
   * Lowercase hex, the same eight bytes the UDP ping carries.
   *
   * What lets a document stored from a previous visit be checked against a
   * server that has not been connected to yet - see `liveryCache`. Optional
   * because a document built by hand in a test, or stored before the field
   * existed, has none, and an unkeyed document is simply never cached.
   */
  digest?: string;
  displayName?: string;
  tagline?: string;
  motd?: string;
  tags: readonly LiveryTag[];
  rulesUrl?: string;
  /**
   * Object URLs for bytes the Rust side already fetched and verified, never a
   * URL the server chose.
   */
  bannerSrc?: string;
  iconSrc?: string;
  /** Where to anchor a banner that has to crop, as percentages. */
  bannerFocus?: { x: number; y: number };
  palette: { dark?: LiveryPalette; light?: LiveryPalette };
}

/** `#rrggbb` to its three channels, or null. */
export function parseHex(value: string | undefined): [number, number, number] | null {
  if (!value) return null;
  const match = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const digits = match[1];
  return [0, 2, 4].map((at) => Number.parseInt(digits.slice(at, at + 2), 16)) as [number, number, number];
}

export function toHex(colour: readonly [number, number, number]): string {
  return `#${colour.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

/** Relative luminance, sRGB transfer function undone first. */
function luminance(colour: readonly [number, number, number]): number {
  const [red, green, blue] = colour.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** WCAG 2.1 contrast ratio, 1 to 21. */
export function contrast(
  one: readonly [number, number, number],
  other: readonly [number, number, number],
): number {
  const [lighter, darker] = [luminance(one), luminance(other)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

export function toHsl(colour: readonly [number, number, number]): [number, number, number] {
  const [red, green, blue] = colour.map((channel) => channel / 255);
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return [0, 0, lightness];
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue: number;
  if (max === red) hue = ((((green - blue) / delta) % 6) + 6) % 6;
  else if (max === green) hue = (blue - red) / delta + 2;
  else hue = (red - green) / delta + 4;
  return [hue * 60, saturation, lightness];
}

export function fromHsl(hue: number, saturation: number, lightness: number): [number, number, number] {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const sector = (((hue % 360) + 360) % 360) / 60;
  const second = chroma * (1 - Math.abs((sector % 2) - 1));
  const table: [number, number, number][] = [
    [chroma, second, 0],
    [second, chroma, 0],
    [0, chroma, second],
    [0, second, chroma],
    [second, 0, chroma],
    [chroma, 0, second],
  ];
  const base = lightness - chroma / 2;
  return table[Math.floor(sector) % 6].map((value) =>
    Math.round(Math.min(255, Math.max(0, (value + base) * 255))),
  ) as [number, number, number];
}

/** Contrast an accent must reach: WCAG's floor for interface components. */
export const CONTRAST_ACCENT = 3;

/**
 * Move `colour` until it reaches `target` against `behind`, keeping its hue.
 *
 * Both directions are tried, nearest first, rather than deciding which way to
 * go from the ground's luminance: every such rule is wrong somewhere, and
 * "away from the ground" sends a near-white accent on a near-white surface
 * further towards white. Walking outwards takes the smallest move that works,
 * so the result stays as close to the operator's colour as the floor allows.
 *
 * This mirrors `starling_runtime::livery::clamp`, which is what
 * `GET /v1/livery/preview` runs so an operator can see the same answer before
 * anybody connects. The client's copy is the load-bearing one: it must clamp
 * whether or not the server chose to.
 */
export function clamp(
  colour: readonly [number, number, number],
  behind: readonly [number, number, number],
  target = CONTRAST_ACCENT,
): [number, number, number] {
  if (contrast(colour, behind) >= target) return [...colour] as [number, number, number];
  const [hue, saturation, lightness] = toHsl(colour);

  let best = [...colour] as [number, number, number];
  let bestContrast = contrast(colour, behind);
  for (let step = 1; step <= 100; step += 1) {
    const offset = step / 100;
    for (const candidate of [lightness + offset, lightness - offset]) {
      if (candidate < 0 || candidate > 1) continue;
      const moved = fromHsl(hue, saturation, candidate);
      const reached = contrast(moved, behind);
      if (reached >= target) return moved;
      if (reached > bestContrast) {
        best = moved;
        bestContrast = reached;
      }
    }
  }
  return best;
}

/**
 * A server colour, clamped against `behind`, or `fallback` when it sent none.
 *
 * The single expression every colour on the ladder resolves through, which is
 * why rungs 1 and 2 need no code of their own: a server that named nothing
 * simply keeps the pack's token.
 */
function colourOr(value: string | undefined, behind: string, fallback: string): string {
  const wanted = parseHex(value);
  const ground = parseHex(behind);
  if (!wanted) return fallback;
  if (!ground) return toHex(wanted);
  return toHex(clamp(wanted, ground));
}

/**
 * Fold a server's palette into the pack's tokens for one mode.
 *
 * Returns `base` unchanged when the server offered nothing for this mode, which
 * is the common case: a palette is opt-in separately from artwork, and a server
 * that sent a banner and no colours is the mock's middle rung.
 */
export function liveryTokens(
  base: NebulaTokens,
  livery: ServerLivery | null,
  mode: NebulaMode,
): NebulaTokens {
  const palette = livery?.palette[mode];
  if (!palette) return base;

  // The operator's surface if they named one, otherwise the pack's, because
  // that is what their accent will actually sit on.
  const surface = parseHex(palette.surface) ? palette.surface! : base.bg0;
  const accent = colourOr(palette.accent, surface, base.accent);
  const parsedAccent = parseHex(accent);

  return {
    ...base,
    bg0: surface,
    accent,
    // Derived from the accent that survived the clamp, not from the one that
    // was sent: otherwise the soft and line variants reintroduce the colour the
    // floor just rejected.
    accentSoft: parsedAccent ? withAlpha(parsedAccent, 0.22) : base.accentSoft,
    accentLine: parsedAccent ? withAlpha(parsedAccent, 0.52) : base.accentLine,
    tint: auraOf(palette, base.tint),
  };
}

function withAlpha(colour: readonly [number, number, number], alpha: number): string {
  return `rgba(${colour[0]},${colour[1]},${colour[2]},${alpha})`;
}

/**
 * The radial wash behind the banner.
 *
 * Built here rather than taken as a string, for the reason the whole module
 * exists: a gradient the server wrote would be CSS the server wrote.
 */
function auraOf(palette: LiveryPalette, fallback: string): string {
  const from = parseHex(palette.auraFrom);
  const to = parseHex(palette.auraTo);
  if (!from && !to) return fallback;
  const stops = [from, to ?? from].filter(Boolean) as [number, number, number][];
  return [
    `radial-gradient(1100px 500px at 22% -6%,${withAlpha(stops[0], 0.22)},transparent 58%)`,
    `radial-gradient(900px 560px at 102% 108%,${withAlpha(stops[1], 0.15)},transparent 62%)`,
  ].join(",");
}

/**
 * Whether livery colour applies at all for this viewer.
 *
 * Accessibility outranks a server's branding unconditionally and without a
 * switch: under a forced palette or a raised contrast preference, the user has
 * already told the platform what they need, and an operator's mood is not a
 * reason to override it.
 */
export function liveryColourAllowed(): boolean {
  if (typeof globalThis.matchMedia !== "function") return true;
  return !(
    globalThis.matchMedia("(forced-colors: active)").matches ||
    globalThis.matchMedia("(prefers-contrast: more)").matches
  );
}
