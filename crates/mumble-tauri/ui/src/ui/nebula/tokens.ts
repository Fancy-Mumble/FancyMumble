/**
 * The Nebula palette, transcribed from the 2026 design mock.
 *
 * The mock is a flat set of CSS custom properties per theme (`--bg0`, `--card`,
 * `--ln`, …). Keeping them here as plain data - rather than inlining them into
 * the MUI theme - means the two colour schemes stay directly comparable, and
 * the theme factory below is the only place that has to know how a mock token
 * maps onto a MUI palette slot.
 */

export type NebulaMode = "light" | "dark";

export interface NebulaTokens {
  /** The app window's own surface. */
  bg0: string;
  /** Translucent chrome (title bar, sidebar, channel header). */
  panel: string;
  /** Raised surface: cards, rows, the composer. */
  card: string;
  /** Second raised step: chips, pressed rows, scrollbar thumbs. */
  card2: string;
  /** Hairline between sections. */
  line: string;
  /** Stronger hairline around cards and floating surfaces. */
  line2: string;
  text: string;
  muted: string;
  dim: string;
  hover: string;
  /**
   * A neutral wash for glass that floats over the wallpaper.
   *
   * `card`/`card2` are tinted towards the scheme's blue, which is right for
   * a panel sitting on the window colour and wrong for one sitting on the
   * wallpaper: the tint reads as a coloured slab instead of glass. The
   * canvas uses a plain white alpha here, and so does this.
   */
  wash: string;
  washLine: string;
  accent: string;
  /**
   * Ink for the one filled element on a surface.
   *
   * Both accents are light enough that white on them is thin, so this is a
   * dark ink rather than a foreground colour picked from the scheme. It is a
   * token rather than a computed contrast because Nebula keeps its own
   * accent - only the mode follows the user's theme.
   */
  onAccent: string;
  accentSoft: string;
  accentLine: string;
  ok: string;
  bad: string;
  warn: string;
  shadow: string;
  /** Radial colour wash layered over `bg0` on floating surfaces. */
  tint: string;
  /** Textured wash behind the conversation, under any user wallpaper. */
  backdrop: string;
}

const DARK_TINT =
  "radial-gradient(1100px 500px at 22% -6%,rgba(65,180,249,.22),transparent 58%)," +
  "radial-gradient(900px 560px at 102% 108%,rgba(125,130,255,.15),transparent 62%)," +
  "radial-gradient(700px 400px at 60% 40%,rgba(65,180,249,.04),transparent 65%)";

/**
 * The default conversation backdrop.
 *
 * Deliberately busier than `tint`: the channel header and composer blur what is
 * behind them, and a smooth gradient blurs to something indistinguishable from
 * itself. Overlapping blobs at different scales give the blur something to
 * actually do, which is what makes that chrome read as glass rather than as a
 * band of flat colour.
 */
const DARK_BACKDROP =
  "radial-gradient(680px 420px at 12% 8%,rgba(65,180,249,.20),transparent 62%)," +
  "radial-gradient(520px 520px at 78% 18%,rgba(125,130,255,.18),transparent 60%)," +
  "radial-gradient(760px 460px at 62% 92%,rgba(80,120,220,.16),transparent 64%)," +
  "radial-gradient(340px 340px at 34% 62%,rgba(65,180,249,.10),transparent 66%)," +
  "linear-gradient(160deg,rgba(30,44,80,.55),rgba(14,20,38,.55))";

const LIGHT_BACKDROP =
  "radial-gradient(680px 420px at 12% 8%,rgba(22,145,220,.14),transparent 62%)," +
  "radial-gradient(520px 520px at 78% 18%,rgba(110,120,235,.12),transparent 60%)," +
  "radial-gradient(760px 460px at 62% 92%,rgba(60,120,200,.10),transparent 64%)," +
  "radial-gradient(340px 340px at 34% 62%,rgba(22,145,220,.08),transparent 66%)," +
  "linear-gradient(160deg,rgba(255,255,255,.5),rgba(240,238,230,.5))";

const LIGHT_TINT =
  "radial-gradient(1100px 500px at 22% -6%,rgba(22,145,220,.11),transparent 58%)," +
  "radial-gradient(900px 560px at 102% 108%,rgba(110,120,235,.07),transparent 62%)";

export const NEBULA_TOKENS: Record<NebulaMode, NebulaTokens> = {
  dark: {
    bg0: "#141d33",
    panel: "rgba(110,165,255,.05)",
    card: "rgba(120,172,255,.10)",
    card2: "rgba(130,178,255,.17)",
    line: "rgba(135,180,255,.07)",
    line2: "rgba(135,180,255,.17)",
    text: "#f1f5ff",
    muted: "#9fb3dd",
    dim: "#65779f",
    hover: "rgba(130,178,255,.12)",
    wash: "rgba(255,255,255,.06)",
    washLine: "rgba(255,255,255,.12)",
    accent: "#7c9fe8",
    onAccent: "#0b1224",
    accentSoft: "rgba(124,159,232,.22)",
    accentLine: "rgba(124,159,232,.38)",
    ok: "#3cd88e",
    bad: "#f57e7e",
    warn: "#ecba55",
    shadow: "0 30px 80px rgba(2,6,18,.6)",
    tint: DARK_TINT,
    backdrop: DARK_BACKDROP,
  },
  light: {
    bg0: "#fdfbf6",
    panel: "rgba(255,253,246,.6)",
    card: "#ffffff",
    card2: "rgba(40,48,80,.06)",
    line: "rgba(40,48,80,.055)",
    line2: "rgba(40,48,80,.12)",
    text: "#252a3c",
    muted: "#666e85",
    dim: "#98a0b4",
    hover: "rgba(40,48,80,.05)",
    wash: "rgba(255,255,255,.55)",
    washLine: "rgba(40,48,80,.14)",
    accent: "#4a6fc4",
    onAccent: "#f7fbff",
    accentSoft: "rgba(74,111,196,.14)",
    accentLine: "rgba(74,111,196,.34)",
    ok: "#1ba572",
    bad: "#d05e5e",
    warn: "#aa8138",
    shadow: "0 30px 60px rgba(50,55,85,.18)",
    tint: LIGHT_TINT,
    backdrop: LIGHT_BACKDROP,
  },
};

/** Geist is the mock's typeface; Inter ships with the app and stands in for it. */
export const NEBULA_SANS = '"Geist","Inter",system-ui,-apple-system,"Segoe UI",sans-serif';
export const NEBULA_MONO = '"Geist Mono","Space Mono",ui-monospace,"Cascadia Mono",monospace';

/**
 * The radius scale.
 *
 * Four steps, and every rounded corner in Nebula is one of them. The mock draws
 * corners by eye, which left the pack with fourteen distinct radii that no
 * screen could hold consistent; a step is chosen by what the element *is*, so
 * two cards can no longer disagree by a pixel.
 *
 * The theme publishes these as `--nebula-radius-*` custom properties on `:root`
 * and components read the variable, never the number - which is what makes the
 * scale adjustable from one place.
 *
 * Circles (`50%`) and pills (`999px`) are shapes rather than radii, and stay
 * written out where they are used.
 */
export const NEBULA_RADIUS = {
  /** Inset detail: code spans, colour swatches, flag thumbs, nested tiles. */
  sm: 6,
  /** Controls: buttons, inputs, menu items, list rows, tooltips. */
  md: 10,
  /** Surfaces: cards, panels, menus, popovers, message bubbles, media. */
  lg: 14,
  /** Overlays and the window itself: dialogs, the shell's outer corner. */
  xl: 20,
} as const;

export type NebulaRadius = keyof typeof NEBULA_RADIUS;

/** `var(--nebula-radius-md)` - how components should spell a radius. */
export function radius(step: NebulaRadius): string {
  return `var(--nebula-radius-${step})`;
}
