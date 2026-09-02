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

  /*
   * The chrome vocabulary the design sheet added.
   *
   * The mock painted the whole window out of one `panel`; the sheet gives the
   * title bar, the server rail and the channel header separate values, because
   * that is where several of the skins put their strongest statement - Mobel's
   * ink rail against bone paper, Midnight's black bar over a light window, Ply's
   * pure-black rail. Every one of these falls back to a value the mock already
   * had, so a theme that says nothing about them looks exactly as it did.
   */

  /** The mesh painted over `bg0` - radial blooms, or `none`. */
  window: string;
  /** Title bar fill. */
  bar: string;
  barText: string;
  barDim: string;
  barFaint: string;
  /** Channel header and composer chrome. */
  header: string;
  /** `card` flattened onto the window - for rings drawn against a card. */
  cardEdge: string;
  /** Search box and composer fill. */
  input: string;
  /** Avatar placeholder, and any other empty bitmap slot. */
  tile: string;
  /** The accent as a foreground, where the fill colour is too light to read. */
  accentText: string;
  /** The scheme's second hue. */
  accent2: string;
  /** The accent against the rail, which is often a different value entirely. */
  accentOnRail: string;
  rail: string;
  /** The rail's own opaque colour, for rings drawn against it. */
  railEdge: string;
  railText: string;
  railDim: string;
  railTile: string;
  railLine: string;
  /** The composer's GIF badge, which several skins invert. */
  gifBg: string;
  gifText: string;
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
    // The mock draws no window mesh and gives the bar, the rail and the header
    // one chrome value between them - so the new slots resolve to what it
    // already had, and the pack's own scheme is unchanged by their arrival.
    window: "none",
    bar: "rgba(110,165,255,.05)",
    barText: "#f1f5ff",
    barDim: "#9fb3dd",
    barFaint: "#65779f",
    header: "rgba(110,165,255,.05)",
    cardEdge: "#1e2b47",
    input: "rgba(130,178,255,.17)",
    tile: "rgba(130,178,255,.17)",
    accentText: "#7c9fe8",
    accent2: "#7d82ff",
    accentOnRail: "#7c9fe8",
    rail: "rgba(110,165,255,.05)",
    railEdge: "#141d33",
    railText: "#9fb3dd",
    railDim: "#65779f",
    railTile: "rgba(130,178,255,.17)",
    railLine: "rgba(135,180,255,.07)",
    gifBg: "rgba(130,178,255,.17)",
    gifText: "#9fb3dd",
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
    window: "none",
    bar: "rgba(255,253,246,.6)",
    barText: "#252a3c",
    barDim: "#666e85",
    barFaint: "#98a0b4",
    header: "rgba(255,253,246,.6)",
    cardEdge: "#ffffff",
    input: "rgba(40,48,80,.06)",
    tile: "rgba(40,48,80,.06)",
    accentText: "#4a6fc4",
    accent2: "#6e78eb",
    accentOnRail: "#4a6fc4",
    rail: "rgba(255,253,246,.6)",
    railEdge: "#fdfbf6",
    railText: "#666e85",
    railDim: "#98a0b4",
    railTile: "rgba(40,48,80,.06)",
    railLine: "rgba(40,48,80,.055)",
    gifBg: "rgba(40,48,80,.06)",
    gifText: "#666e85",
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

/**
 * The steps a component may ask for.
 *
 * Four from the mock's own scale, plus the two the design sheet gives a theme
 * separate control of: rail tiles and avatars, which several skins shape
 * differently from every other control (Mobel squares them, Rose rounds them
 * to a circle while its cards stay at 22px).
 */
export type NebulaRadius = keyof typeof NEBULA_RADIUS | "rail" | "avatar";

/** `var(--nebula-radius-md)` - how components should spell a radius. */
export function radius(step: NebulaRadius): string {
  return `var(--nebula-radius-${step})`;
}

/**
 * A translucent surface token, made opaque over the window's own colour.
 *
 * `card` and its neighbours are alphas, which is right for a panel sitting on
 * the window: the wash behind shows through and the surface belongs to the
 * room. It is wrong the moment two of them overlap - a node dragged across
 * another on the canvas would be 90% the node underneath - so a surface that
 * can stack asks for this instead and gets the same colour with nothing behind
 * it. Layered rather than pre-multiplied so the token stays the token: change
 * the palette and this follows.
 */
export function opaque(colour: string, over: string): string {
  return `linear-gradient(${colour}, ${colour}), ${over}`;
}

/**
 * The width of the conversation, and the gap between it and the pane's edge.
 *
 * One pair of numbers because the river and the composer are one column: the
 * composer is the bottom of the thing the messages are written in, and a
 * message that stopped short of where the box below it begins reads as two
 * columns that happen to be stacked. They were 980/20 and 1360/10, which is
 * exactly what that looked like.
 */
export const CHAT_COLUMN_MAX_WIDTH = 1360;
export const CHAT_COLUMN_INSET_PX = 10;
