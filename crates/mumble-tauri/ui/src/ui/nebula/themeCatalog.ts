/**
 * The twelve skins, as the design sheet authored them.
 *
 * Transcribed from "Fancy Mumble Light Theme" (turn 4, one aesthetic per
 * audience). Each theme commits to an audience and pushes four levers at once -
 * palette, corner language, type voice, and how much of the background the
 * chrome lets through - while the layout, spacing and anatomy stay identical.
 * That is why this file is data and not code: the sheet *is* the specification,
 * and anything computed from it lives in `themeScheme.ts` next door.
 *
 * # Two palettes per theme
 *
 * The names are brands, not modes. "Dark" is the everyday default and "Light"
 * is the enterprise skin, and each of the twelve is drawn in both a light and a
 * dark scheme - which is why the pack needs a light/dark choice of its own,
 * separate from which theme is picked.
 *
 * # What is not transcribed verbatim
 *
 * - **Typefaces.** The sheet names twelve Google families; the app bundles
 *   Inter, Roboto and Space Mono. Each stack below asks for the sheet's family
 *   first and falls back to a bundled face of the same voice, so a theme reads
 *   correctly today and reads exactly right the moment the font file ships.
 * - **Danger and warning.** The sheet draws no destructive or warning state, so
 *   those two are the pack's own, clamped for contrast against the theme's
 *   window. A theme that has an opinion states it (Ply reserves red).
 */

/** The twelve. Eleven match the app's existing colour themes; Aurora is new. */
export type NebulaThemeId =
  | "dark"
  | "light"
  | "apprentice"
  | "mobel"
  | "rose"
  | "inversa"
  | "hearth"
  | "macchiato"
  | "midnight-pretenders"
  | "ply"
  | "guardbase"
  | "aurora";

/**
 * One scheme's colours.
 *
 * Every optional field falls back to another in `themeScheme.ts` exactly as the
 * sheet's own `build()` does, so a palette states only what it wants to differ.
 */
export interface NebulaPalette {
  /** The window's own colour, under everything. */
  app: string;
  /** The mesh painted over `app` - radial blooms, or a flat wash. */
  windowBg?: string;
  /** Title bar. Defaults to `app`. */
  bar?: string;
  /** The channel column. */
  side: string;
  /** A raised surface: cards, the user tile. */
  surface: string;
  /** Channel header and composer chrome. Defaults to `surface`. */
  header?: string;
  /** The card fill, where it differs from `surface`. */
  card?: string;
  /** Chips, badges, the keyboard hint. */
  chip: string;
  /** Search box and composer fill. */
  input: string;
  /** Avatar placeholder. */
  tile: string;
  border: string;
  text: string;
  /** Second text rung: captions, section labels. */
  dim: string;
  /** Third rung: placeholders, icons at rest. */
  faint: string;
  /** The title bar's own three rungs, where it inverts against the window. */
  barFg?: string;
  barDim?: string;
  barFaint?: string;
  rail: string;
  railFg: string;
  railDim: string;
  railTile: string;
  railBorder?: string;
  accent: string;
  /** The scheme's second hue - what keeps a mesh from being monochrome. */
  accent2: string;
  /** The accent as a foreground, where the fill colour is too light to read. */
  accentFg?: string;
  /** The accent against the rail, which is often a different value entirely. */
  accentOnRail?: string;
  /** Ink on a filled accent. Defaults to white. */
  onAccent?: string;
  /** Presence. Defaults to the pack's green. */
  online?: string;
  /** Destructive. Absent from the sheet; the pack's own unless stated. */
  danger?: string;
  /** Caution. Absent from the sheet; the pack's own unless stated. */
  warning?: string;
  gifBg?: string;
  gifFg?: string;
  /** The conversation's own gradient, top and bottom. */
  canvasA: string;
  canvasB: string;
  /** The veil drawn over that gradient, which is what the chrome blurs. */
  wash: string;
  /** A texture over the whole canvas - scanlines, and nothing else so far. */
  overlay?: string;
  overlayOpacity?: number;
}

/** How a theme selects a channel row. */
export type NebulaSelection = "wash" | "solid";

/**
 * Everything about a theme that is not a colour.
 *
 * The sheet's claim is that these carry as much of a theme's identity as the
 * palette does - a 0px slab in a serif is a different product from a full pill
 * in a rounded sans, in the same colours.
 */
export interface NebulaSkin {
  /** Font stack: the sheet's family, then a bundled face of the same voice. */
  font: string;
  /** Tracking, as a CSS length. */
  track: string;
  /** Whether the theme shouts. */
  caps: "none" | "uppercase";
  /** Base weight for body copy and rows. */
  weight: number;
  /** Inset detail: swatches, chips, code. */
  radiusSm: string;
  /** Controls: buttons, inputs, rows, menu items. */
  radiusMd: string;
  /** Surfaces: cards, panels, bubbles, media. */
  radiusLg: string;
  /** The window itself, and the overlays that sit on it. */
  radiusXl: string;
  /** Rail tiles, which several themes shape differently from other controls. */
  radiusRail: string;
  /** Avatars. `50%` unless the theme squares them off. */
  radiusAvatar: string;
  /** A notched window outline, for the themes that cut their corners. */
  clipWindow: string;
  /** The same notch on a selected row. */
  clipSelection: string;
  /**
   * The same notch on a message bubble.
   *
   * Its own value rather than a reuse of `clipSelection`: a row is 32px tall
   * and a bubble can be four lines, so the cut that reads as a chamfer on one
   * reads as a missing corner on the other. Only the HUD skins set it.
   */
  clipBubble: string;
  selection: NebulaSelection;
  /** A glow behind the selected row. */
  selectionGlow: boolean;
  /** An inset bar down the selected row's leading edge. */
  selectionBar: boolean;
  /**
   * How much of the background the chrome lets through: 0 opaque, .12 a light
   * veil, .28 frosted, .45 and up heavy glass.
   */
  glass: number;
  /** Backdrop blur behind the chrome, in pixels. */
  blurPx: number;
}

export interface NebulaThemeDef {
  id: NebulaThemeId;
  name: string;
  /** Who the skin is for. The sheet's organising idea, and worth keeping. */
  audience: string;
  /** One line on what the four levers are set to. */
  note: string;
  skin: NebulaSkin;
  light: NebulaPalette;
  dark: NebulaPalette;
}

/**
 * The sheet's twelve families, each followed by a bundled face of the same
 * voice. Only Inter, Roboto and Space Mono ship with the app today.
 */
const FONTS = {
  interTight: '"Inter Tight","Inter",system-ui,-apple-system,"Segoe UI",sans-serif',
  archivo: '"Archivo","Roboto",system-ui,"Segoe UI",sans-serif',
  jetBrains: '"JetBrains Mono","Space Mono",ui-monospace,"Cascadia Mono",monospace',
  fraunces: '"Fraunces",Georgia,"Times New Roman",serif',
  bricolage: '"Bricolage Grotesque","Inter",system-ui,sans-serif',
  nunito: '"Nunito","Quicksand","Segoe UI",system-ui,sans-serif',
  newsreader: '"Newsreader",Georgia,"Times New Roman",serif',
  dmSans: '"DM Sans","Inter",system-ui,sans-serif',
  chakra: '"Chakra Petch","Rajdhani","Roboto Condensed","Roboto",system-ui,sans-serif',
  spaceGrotesk: '"Space Grotesk","Space Mono","Inter",system-ui,sans-serif',
  rajdhani: '"Rajdhani","Chakra Petch","Roboto Condensed","Roboto",system-ui,sans-serif',
  outfit: '"Outfit","Inter",system-ui,sans-serif',
} as const;

/**
 * The mock's own shape and voice.
 *
 * Also what a theme the sheet does not draw is rendered in, so the CSS-derived
 * fallback path stays a *colour* fallback and never a shapeless one.
 */
export const DEFAULT_SKIN: NebulaSkin = {
  font: '"Geist","Inter",system-ui,-apple-system,"Segoe UI",sans-serif',
  track: "0",
  caps: "none",
  weight: 400,
  radiusSm: "6px",
  radiusMd: "10px",
  radiusLg: "14px",
  radiusXl: "20px",
  radiusRail: "10px",
  radiusAvatar: "50%",
  clipWindow: "none",
  clipSelection: "none",
  clipBubble: "none",
  selection: "wash",
  selectionGlow: false,
  selectionBar: false,
  glass: 0,
  blurPx: 18,
};

/** The sheet's defaults, so each skin below states only what it changes. */
function skin(over: Partial<NebulaSkin> & Pick<NebulaSkin, "font">): NebulaSkin {
  return {
    track: "0",
    caps: "none",
    weight: 400,
    radiusSm: "8px",
    radiusMd: "10px",
    radiusLg: "12px",
    radiusXl: "14px",
    radiusRail: "10px",
    radiusAvatar: "50%",
    clipWindow: "none",
    clipSelection: "none",
    clipBubble: "none",
    selection: "wash",
    selectionGlow: false,
    selectionBar: false,
    glass: 0,
    blurPx: 18,
    ...over,
  };
}

export const NEBULA_THEMES: readonly NebulaThemeDef[] = [
  {
    id: "dark",
    name: "Dark",
    audience: "everyday users · the house default",
    note: "10px radius · Inter Tight · neutral greys, one blue accent, light veil",
    skin: skin({
      font: FONTS.interTight,
      radiusSm: "8px",
      radiusMd: "10px",
      radiusLg: "12px",
      radiusXl: "14px",
      radiusRail: "10px",
      glass: 0.14,
      blurPx: 20,
    }),
    light: {
      app: "#e9eefb",
      windowBg:
        "radial-gradient(120% 90% at 15% 0%, #dfe8ff 0%, rgba(223,232,255,0) 60%), radial-gradient(90% 80% at 100% 100%, #e9ebf0 0%, rgba(233,235,240,0) 65%), linear-gradient(160deg,#f1f3f7,#e6e9ef)",
      bar: "#ffffff",
      side: "#eef2fc",
      surface: "#ffffff",
      header: "#f8faff",
      chip: "#dde5f8",
      input: "#f2f6ff",
      tile: "#c9d8f5",
      border: "#cfdbf3",
      text: "#141c33",
      dim: "#4f5d85",
      faint: "#8493b8",
      rail: "#e2e9fa",
      railFg: "#3a4870",
      railDim: "#93a1c4",
      railTile: "#ccd8f4",
      accent: "#3a6bcc",
      accent2: "#6c778c",
      canvasA: "#ebeef4",
      canvasB: "#dde1ea",
      wash: "linear-gradient(180deg, rgba(58,107,204,.04), rgba(255,255,255,.72) 45%, rgba(255,255,255,.86))",
    },
    dark: {
      app: "#0f1420",
      windowBg:
        "radial-gradient(120% 90% at 10% 0%, #1c2647 0%, rgba(28,38,71,0) 62%), radial-gradient(90% 80% at 100% 100%, #22273a 0%, rgba(34,39,58,0) 66%), linear-gradient(160deg,#13161d,#0c0e13)",
      bar: "#0e1420",
      side: "#141b2b",
      surface: "#182031",
      header: "#151c2c",
      chip: "#222b42",
      input: "#141b2b",
      tile: "#2a3550",
      border: "#2a3450",
      text: "#e7ecfa",
      dim: "#98a4c6",
      faint: "#68759a",
      rail: "#0b1018",
      railFg: "#b3bfe0",
      railDim: "#5b678a",
      railTile: "#1b2337",
      railBorder: "#1b2337",
      accent: "#7ba1d8",
      accent2: "#8c94a3",
      onAccent: "#07101f",
      canvasA: "#1d222c",
      canvasB: "#131720",
      wash: "linear-gradient(180deg, rgba(123,161,216,.07), rgba(8,12,22,.42) 45%, rgba(8,12,22,.56))",
    },
  },

  {
    id: "light",
    name: "Light",
    audience: "business · enterprise workspaces",
    note: "2px corners · Archivo · opaque, hairline rules, muted navy + grey only",
    skin: skin({
      font: FONTS.archivo,
      track: "-.005em",
      radiusSm: "2px",
      radiusMd: "2px",
      radiusLg: "2px",
      radiusXl: "2px",
      radiusRail: "2px",
      radiusAvatar: "2px",
      glass: 0,
    }),
    light: {
      app: "#ffffff",
      windowBg: "linear-gradient(180deg,#ffffff,#fbfbfc)",
      bar: "#ffffff",
      side: "#f7f8f9",
      surface: "#ffffff",
      header: "#ffffff",
      chip: "#eceef1",
      input: "#f4f5f7",
      tile: "#d9dce1",
      border: "#dfe2e7",
      text: "#0d1117",
      dim: "#525a66",
      faint: "#8b929c",
      rail: "#f0f1f3",
      railFg: "#3a424d",
      railDim: "#989ea8",
      railTile: "#e3e5e9",
      accent: "#2b4a6f",
      accent2: "#6a7079",
      canvasA: "#fafbfc",
      canvasB: "#f0f2f5",
      wash: "linear-gradient(180deg, rgba(43,74,111,.02), rgba(255,255,255,.55) 40%, rgba(255,255,255,.78))",
    },
    dark: {
      app: "#1c1f24",
      windowBg: "linear-gradient(180deg,#1e2126,#191b1f)",
      bar: "#1a1d21",
      side: "#212429",
      surface: "#26292f",
      header: "#232629",
      chip: "#31353b",
      input: "#1f2226",
      tile: "#3c4147",
      border: "#33373d",
      text: "#f0f2f5",
      dim: "#a5abb5",
      faint: "#7b818b",
      rail: "#17191d",
      railFg: "#c8ccd3",
      railDim: "#767c86",
      railTile: "#282b31",
      railBorder: "#282b31",
      accent: "#7f9cbb",
      accent2: "#8d939c",
      onAccent: "#07182b",
      canvasA: "#2a2d33",
      canvasB: "#212429",
      wash: "linear-gradient(180deg, rgba(127,156,187,.04), rgba(14,16,18,.3) 45%, rgba(14,16,18,.44))",
    },
  },

  /*
   * Apprentice was revised after this file was transcribed, and the fetched
   * copy of the sheet still held the earlier "JetBrains Mono · graphite rail"
   * cut. The values below are read off the current artboard - Inter Tight, 3px,
   * opaque, an OLED true-black shell against a paper-white one with a grey
   * channel column - so the theme is right in kind and close in value, but it
   * is the one entry here that is not a literal transcription. Re-fetching the
   * sheet is what settles the exact hexes.
   */
  {
    id: "apprentice",
    name: "Apprentice",
    audience: "developers · pure black / pure white",
    note: "3px corners · Inter Tight · OLED true-black shell vs. paper-white shell, grey channel column",
    skin: skin({
      font: FONTS.interTight,
      radiusSm: "3px",
      radiusMd: "3px",
      radiusLg: "3px",
      radiusXl: "3px",
      radiusRail: "3px",
      radiusAvatar: "3px",
      glass: 0,
    }),
    light: {
      app: "#ffffff",
      windowBg: "linear-gradient(180deg,#ffffff,#fbfbfc)",
      bar: "#ffffff",
      side: "#f4f5f7",
      surface: "#ffffff",
      header: "#ffffff",
      chip: "#e9eaee",
      input: "#ffffff",
      tile: "#d7d9de",
      border: "#e2e4e8",
      text: "#0b0d10",
      dim: "#4d5560",
      faint: "#828b96",
      rail: "#f0f1f3",
      railFg: "#3a424d",
      railDim: "#98a0aa",
      railTile: "#e3e5e9",
      accent: "#2f5599",
      accent2: "#4f647a",
      canvasA: "#ffffff",
      canvasB: "#f7f8fa",
      wash: "linear-gradient(180deg, rgba(47,85,153,.03), rgba(255,255,255,.6) 45%, rgba(255,255,255,.8))",
    },
    dark: {
      app: "#000000",
      windowBg: "linear-gradient(180deg,#050506,#000000)",
      bar: "#000000",
      side: "#101214",
      surface: "#141619",
      header: "#0d0f11",
      chip: "#1e2126",
      input: "#0c0e10",
      tile: "#2a2e34",
      border: "#212429",
      text: "#e8ecf1",
      dim: "#98a1ac",
      faint: "#6b7480",
      rail: "#000000",
      railFg: "#b6c0cc",
      railDim: "#5b646f",
      railTile: "#141719",
      railBorder: "#000000",
      accent: "#3f7fe0",
      accent2: "#8598ab",
      canvasA: "#0a0b0d",
      canvasB: "#000000",
      wash: "linear-gradient(180deg, rgba(63,127,224,.06), rgba(0,0,0,.4) 45%, rgba(0,0,0,.55))",
    },
  },

  {
    id: "mobel",
    name: "Mobel",
    audience: "design studios · editorial teams",
    note: "0px slabs · Fraunces serif · bone paper, ink rail, muted ochre",
    skin: skin({
      font: FONTS.fraunces,
      track: "-.015em",
      radiusSm: "0px",
      radiusMd: "0px",
      radiusLg: "0px",
      radiusXl: "4px",
      radiusRail: "0px",
      radiusAvatar: "0px",
      glass: 0,
      selection: "solid",
    }),
    light: {
      app: "#fffdf7",
      windowBg: "linear-gradient(180deg,#fffdf7,#faf5e6)",
      bar: "#ffffff",
      side: "#faf6ea",
      surface: "#fffdf7",
      header: "#fffdf7",
      chip: "#efe8d3",
      input: "#f7f2e2",
      tile: "#e2d9bd",
      border: "#e6ddc4",
      text: "#15140d",
      dim: "#57513a",
      faint: "#8c866c",
      rail: "#14140f",
      railFg: "#f0ecdb",
      railDim: "#7d7a68",
      railTile: "#292818",
      railBorder: "#292818",
      accent: "#bf9836",
      accent2: "#a83232",
      onAccent: "#1a1400",
      accentOnRail: "#d8b866",
      accentFg: "#7d6420",
      danger: "#a83232",
      canvasA: "#f8f2df",
      canvasB: "#ece2c6",
      wash: "linear-gradient(180deg, rgba(191,152,54,.05), rgba(255,253,247,.7) 45%, rgba(255,253,247,.85))",
    },
    dark: {
      app: "#15140d",
      windowBg: "linear-gradient(180deg,#17160e,#100f08)",
      bar: "#0f0e09",
      side: "#1b1a11",
      surface: "#201e14",
      header: "#1d1b12",
      chip: "#2e2b1b",
      input: "#191811",
      tile: "#3a3623",
      border: "#332f1e",
      text: "#f7f2df",
      dim: "#b3ab8a",
      faint: "#847d61",
      rail: "#080803",
      railFg: "#e7e0c5",
      railDim: "#6d6851",
      railTile: "#211f14",
      railBorder: "#211f14",
      accent: "#d8b45e",
      accent2: "#cf5145",
      onAccent: "#1a1500",
      accentFg: "#d8b45e",
      danger: "#cf5145",
      canvasA: "#252212",
      canvasB: "#16150c",
      wash: "linear-gradient(180deg, rgba(216,180,94,.07), rgba(8,8,3,.42) 45%, rgba(8,8,3,.56))",
    },
  },

  {
    id: "rose",
    name: "Rose",
    audience: "friend groups · social & creative circles",
    note: "full pills · Bricolage Grotesque · frosted blush glass over a candy mesh",
    skin: skin({
      font: FONTS.bricolage,
      radiusSm: "999px",
      radiusMd: "999px",
      radiusLg: "22px",
      radiusXl: "22px",
      radiusRail: "999px",
      glass: 0.3,
      blurPx: 26,
    }),
    light: {
      app: "#fdf0f7",
      windowBg:
        "radial-gradient(90% 70% at 10% 0%, #ffd9ee 0%, rgba(255,217,238,0) 60%), radial-gradient(80% 70% at 95% 95%, #e2d2ff 0%, rgba(226,210,255,0) 62%), linear-gradient(150deg,#fff2fa,#fbe6f4)",
      bar: "#fff8fc",
      side: "#fdeef6",
      surface: "#fffbfd",
      header: "#fef6fb",
      chip: "#f9e0ef",
      input: "#fef4fa",
      tile: "#f4cde2",
      border: "#f4d8e9",
      text: "#3a1230",
      dim: "#7c4468",
      faint: "#ad7c98",
      rail: "#fce9f4",
      railFg: "#7a3a63",
      railDim: "#bb8ba9",
      railTile: "#f5d3e8",
      accent: "#d61f88",
      accent2: "#8f4ede",
      canvasA: "#fbe8f5",
      canvasB: "#f1d4ea",
      wash: "linear-gradient(180deg, rgba(214,31,136,.05), rgba(255,251,253,.62) 45%, rgba(255,251,253,.8))",
    },
    dark: {
      app: "#1b0f19",
      windowBg:
        "radial-gradient(90% 70% at 12% 0%, #4a1240 0%, rgba(74,18,64,0) 60%), radial-gradient(80% 70% at 95% 98%, #33195e 0%, rgba(51,25,94,0) 62%), linear-gradient(150deg,#1e1020,#140a14)",
      bar: "#1d1020",
      side: "#241428",
      surface: "#281628",
      header: "#251527",
      chip: "#3d2340",
      input: "#201222",
      tile: "#4a2a4c",
      border: "#3e2440",
      text: "#fbe7f5",
      dim: "#c69ab8",
      faint: "#946a88",
      rail: "#180d18",
      railFg: "#e3bdd6",
      railDim: "#7d5772",
      railTile: "#2e192c",
      railBorder: "#2e192c",
      accent: "#ff56a8",
      accent2: "#c58cf5",
      onAccent: "#2b0018",
      canvasA: "#2d1730",
      canvasB: "#190d1c",
      wash: "linear-gradient(180deg, rgba(255,86,168,.11), rgba(12,4,12,.36) 45%, rgba(12,4,12,.5))",
    },
  },

  {
    id: "inversa",
    name: "Inversa",
    audience: "families · household & school groups",
    note: "20px pebbles · Nunito · cream + muted sage, soft veil, high legibility",
    skin: skin({
      font: FONTS.nunito,
      radiusSm: "14px",
      radiusMd: "20px",
      radiusLg: "24px",
      radiusXl: "20px",
      radiusRail: "18px",
      glass: 0.12,
      blurPx: 14,
    }),
    light: {
      app: "#f6f7ea",
      windowBg:
        "radial-gradient(80% 60% at 0% 0%, #eaf3d8 0%, rgba(234,243,216,0) 62%), linear-gradient(160deg,#f9faee,#eff2dd)",
      bar: "#fcfdf3",
      side: "#f2f5e2",
      surface: "#fdfef7",
      header: "#f7f9ea",
      chip: "#e4e9cb",
      input: "#f4f7e2",
      tile: "#d5dcb4",
      border: "#dee3c4",
      text: "#1f2413",
      dim: "#556033",
      faint: "#879063",
      rail: "#e9eed6",
      railFg: "#4a5527",
      railDim: "#96a077",
      railTile: "#dbe2bf",
      accent: "#65805c",
      accent2: "#9a8a68",
      canvasA: "#eef2da",
      canvasB: "#e2e8c6",
      wash: "linear-gradient(180deg, rgba(101,128,92,.05), rgba(253,254,247,.68) 45%, rgba(253,254,247,.84))",
    },
    dark: {
      app: "#16190f",
      windowBg:
        "radial-gradient(80% 60% at 0% 0%, #202a13 0%, rgba(32,42,19,0) 62%), linear-gradient(160deg,#181b10,#12140b)",
      bar: "#14170d",
      side: "#1c2012",
      surface: "#212517",
      header: "#1e2214",
      chip: "#2d331d",
      input: "#191d10",
      tile: "#39401f",
      border: "#313720",
      text: "#eff2dc",
      dim: "#a9b189",
      faint: "#7a8160",
      rail: "#101208",
      railFg: "#d6dcb8",
      railDim: "#666d4c",
      railTile: "#232816",
      railBorder: "#232816",
      accent: "#a2b98d",
      accent2: "#c0ad86",
      onAccent: "#101a0b",
      canvasA: "#242a16",
      canvasB: "#171a0e",
      wash: "linear-gradient(180deg, rgba(162,185,141,.07), rgba(6,8,3,.4) 45%, rgba(6,8,3,.54))",
    },
  },

  {
    id: "hearth",
    name: "Hearth",
    audience: "book clubs · slow, cozy communities",
    note: "16px · Newsreader serif · terracotta on sand, single warm accent family",
    skin: skin({
      font: FONTS.newsreader,
      radiusSm: "12px",
      radiusMd: "16px",
      radiusLg: "20px",
      radiusXl: "18px",
      radiusRail: "14px",
      glass: 0.16,
      blurPx: 16,
    }),
    light: {
      app: "#fbf1e4",
      windowBg:
        "radial-gradient(90% 70% at 100% 0%, #ffe6c9 0%, rgba(255,230,201,0) 60%), linear-gradient(160deg,#fdf5eb,#f7ead9)",
      bar: "#fff9f2",
      side: "#f9eede",
      surface: "#fffaf4",
      header: "#fdf5ec",
      chip: "#f1decb",
      input: "#fcf2e6",
      tile: "#ebd2b4",
      border: "#eddbc4",
      text: "#33200f",
      dim: "#75563a",
      faint: "#a48a70",
      rail: "#f5e6d3",
      railFg: "#6e4f33",
      railDim: "#b0977c",
      railTile: "#ead2b5",
      accent: "#b3651f",
      accent2: "#8a5c3d",
      canvasA: "#f8ebda",
      canvasB: "#efdac0",
      wash: "linear-gradient(180deg, rgba(189,95,28,.06), rgba(255,250,244,.66) 45%, rgba(255,250,244,.82))",
    },
    dark: {
      app: "#1b130e",
      windowBg:
        "radial-gradient(90% 70% at 100% 0%, #3a2213 0%, rgba(58,34,19,0) 60%), linear-gradient(160deg,#1d1510,#140d09)",
      bar: "#191109",
      side: "#241a13",
      surface: "#281d16",
      header: "#251b14",
      chip: "#3c2c20",
      input: "#1f1610",
      tile: "#4a3526",
      border: "#3d2c20",
      text: "#f8ead9",
      dim: "#c2a68c",
      faint: "#907760",
      rail: "#150e09",
      railFg: "#e2c9ad",
      railDim: "#7b6250",
      railTile: "#2c1f16",
      railBorder: "#2c1f16",
      accent: "#e59247",
      accent2: "#c08f6a",
      onAccent: "#2b1400",
      canvasA: "#2e2015",
      canvasB: "#1a120c",
      wash: "linear-gradient(180deg, rgba(238,148,64,.10), rgba(10,6,3,.38) 45%, rgba(10,6,3,.52))",
    },
  },

  {
    id: "macchiato",
    name: "Macchiato",
    audience: "students · casual everyday chat",
    note: "12px · DM Sans · heavy frosted glass, lavender haze, low contrast",
    skin: skin({
      font: FONTS.dmSans,
      radiusSm: "10px",
      radiusMd: "12px",
      radiusLg: "16px",
      radiusXl: "18px",
      radiusRail: "12px",
      glass: 0.42,
      blurPx: 30,
    }),
    light: {
      app: "#f1f0fb",
      windowBg:
        "radial-gradient(80% 65% at 5% 0%, #d9dcff 0%, rgba(217,220,255,0) 62%), radial-gradient(75% 60% at 100% 90%, #ffd9ec 0%, rgba(255,217,236,0) 62%), linear-gradient(150deg,#f4f3ff,#e9e9f9)",
      bar: "#ffffff",
      side: "#f2f2fd",
      surface: "#fdfdff",
      header: "#f8f8ff",
      chip: "#e4e4f7",
      input: "#f6f6ff",
      tile: "#d2d5f2",
      border: "#e0e0f4",
      text: "#1e1e35",
      dim: "#5a5b80",
      faint: "#8d8fb0",
      rail: "#eeeefb",
      railFg: "#4a4b72",
      railDim: "#9b9dbf",
      railTile: "#dcdcf5",
      accent: "#6f7ce4",
      accent2: "#d99cc4",
      onAccent: "#ffffff",
      canvasA: "#ecebfc",
      canvasB: "#dfdff4",
      wash: "linear-gradient(180deg, rgba(85,102,216,.05), rgba(253,253,255,.6) 45%, rgba(253,253,255,.78))",
    },
    dark: {
      app: "#191a2a",
      windowBg:
        "radial-gradient(80% 65% at 5% 0%, #2c2f59 0%, rgba(44,47,89,0) 62%), radial-gradient(75% 60% at 100% 90%, #4a2544 0%, rgba(74,37,68,0) 62%), linear-gradient(150deg,#1b1c2e,#131424)",
      bar: "#1e2034",
      side: "#22243a",
      surface: "#24263c",
      header: "#232540",
      chip: "#33365a",
      input: "#1f2136",
      tile: "#3d4069",
      border: "#353859",
      text: "#e9eafa",
      dim: "#a7a9cd",
      faint: "#78799e",
      rail: "#181a2e",
      railFg: "#c3c5e8",
      railDim: "#6a6c92",
      railTile: "#282b48",
      railBorder: "#282b48",
      accent: "#a3b4f5",
      accent2: "#f0a8cf",
      onAccent: "#141634",
      canvasA: "#282a45",
      canvasB: "#181a2c",
      wash: "linear-gradient(180deg, rgba(163,180,245,.09), rgba(8,9,18,.34) 45%, rgba(8,9,18,.48))",
    },
  },

  {
    id: "midnight-pretenders",
    name: "Midnight Pretenders",
    audience: "gaming · cyberpunk raid squads",
    note: "notched HUD panels · Chakra Petch caps · near-black + dirty steel, acid yellow signal, cyan data, magenta alert, CRT scanlines",
    skin: skin({
      font: FONTS.chakra,
      track: ".04em",
      caps: "uppercase",
      weight: 500,
      radiusSm: "0px",
      radiusMd: "0px",
      radiusLg: "0px",
      radiusXl: "0px",
      radiusRail: "0px",
      radiusAvatar: "0px",
      clipWindow:
        "polygon(0 14px, 14px 0, calc(100% - 28px) 0, 100% 28px, 100% calc(100% - 14px), calc(100% - 14px) 100%, 28px 100%, 0 calc(100% - 28px))",
      clipSelection: "polygon(0 0, calc(100% - 9px) 0, 100% 9px, 100% 100%, 9px 100%, 0 calc(100% - 9px))",
      clipBubble: "polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 12px 100%, 0 calc(100% - 12px))",
      selection: "solid",
      selectionGlow: true,
      glass: 0.22,
      blurPx: 10,
    }),
    light: {
      app: "#d5d7d1",
      windowBg: "linear-gradient(150deg,#dcded7,#c9ccc4)",
      overlay:
        "repeating-linear-gradient(0deg, rgba(0,0,0,.06) 0px, rgba(0,0,0,.06) 1px, rgba(0,0,0,0) 1px, rgba(0,0,0,0) 3px)",
      overlayOpacity: 0.5,
      bar: "#0e0f0d",
      side: "#e2e4dd",
      surface: "#eceee7",
      header: "#e6e8e1",
      chip: "#d2d5cc",
      input: "#e6e8e1",
      tile: "#bcbfb6",
      border: "#b4b7ad",
      text: "#0d0f0c",
      dim: "#4a4e46",
      faint: "#75796f",
      barFg: "#f0f2ec",
      barDim: "#9aa093",
      barFaint: "#6f746a",
      rail: "#0b0c0a",
      railFg: "#e8e400",
      railDim: "#5d6055",
      railTile: "#181a16",
      railBorder: "#000000",
      accent: "#b8ad00",
      accent2: "#00707f",
      onAccent: "#0b0c00",
      accentOnRail: "#e8e400",
      accentFg: "#6f6800",
      danger: "#a1005e",
      gifBg: "#0e0f0d",
      gifFg: "#e8e400",
      canvasA: "#dfe1da",
      canvasB: "#c8cbc2",
      wash: "linear-gradient(180deg, rgba(184,173,0,.06), rgba(236,238,231,.6) 45%, rgba(236,238,231,.78))",
    },
    dark: {
      app: "#07080a",
      windowBg:
        "radial-gradient(70% 55% at 0% 0%, #123640 0%, rgba(18,54,64,0) 58%), radial-gradient(60% 55% at 100% 100%, #35062a 0%, rgba(53,6,42,0) 60%), linear-gradient(150deg,#0a0c10,#050608)",
      overlay:
        "repeating-linear-gradient(0deg, rgba(0,0,0,.16) 0px, rgba(0,0,0,.16) 1px, rgba(0,0,0,0) 1px, rgba(0,0,0,0) 3px)",
      overlayOpacity: 0.6,
      bar: "#000000",
      side: "#0d1015",
      surface: "#0f1318",
      header: "#0c0f13",
      chip: "#191e26",
      input: "#0a0d11",
      tile: "#232a34",
      border: "#242b35",
      text: "#e9ece9",
      dim: "#8c95a0",
      faint: "#5d6671",
      rail: "#000000",
      railFg: "#fcee0a",
      railDim: "#4a525c",
      railTile: "#12161c",
      railBorder: "#000000",
      accent: "#fcee0a",
      accent2: "#00e5ff",
      onAccent: "#0a0a00",
      accentFg: "#fcee0a",
      danger: "#ff2f8f",
      gifBg: "#00232b",
      gifFg: "#00e5ff",
      online: "#00ff6a",
      canvasA: "#0c1218",
      canvasB: "#05070a",
      wash: "linear-gradient(180deg, rgba(252,238,10,.05), rgba(2,3,5,.46) 45%, rgba(2,3,5,.6))",
    },
  },

  {
    id: "ply",
    name: "Ply",
    audience: "minimalists · power users who want no chrome",
    note: "0px everywhere · Space Grotesk · pure black/white, red reserved for destructive, no blur",
    skin: skin({
      font: FONTS.spaceGrotesk,
      track: "-.015em",
      radiusSm: "0px",
      radiusMd: "0px",
      radiusLg: "0px",
      radiusXl: "0px",
      radiusRail: "0px",
      radiusAvatar: "0px",
      glass: 0,
      selection: "solid",
    }),
    light: {
      app: "#ffffff",
      windowBg: "#ffffff",
      bar: "#ffffff",
      side: "#f2f2f2",
      surface: "#ffffff",
      header: "#ffffff",
      chip: "#e6e6e6",
      input: "#f5f5f5",
      tile: "#d4d4d4",
      border: "#d8d8d8",
      text: "#000000",
      dim: "#5c5c5c",
      faint: "#8f8f8f",
      rail: "#000000",
      railFg: "#ffffff",
      railDim: "#6e6e6e",
      railTile: "#1e1e1e",
      railBorder: "#000000",
      accent: "#111111",
      accent2: "#e01414",
      accentOnRail: "#ffffff",
      accentFg: "#111111",
      danger: "#e01414",
      canvasA: "#f4f4f4",
      canvasB: "#e6e6e6",
      wash: "linear-gradient(180deg, rgba(0,0,0,.02), rgba(255,255,255,.55) 40%, rgba(255,255,255,.75))",
    },
    dark: {
      app: "#111111",
      windowBg: "#111111",
      bar: "#0a0a0a",
      side: "#171717",
      surface: "#1c1c1c",
      header: "#191919",
      chip: "#2a2a2a",
      input: "#141414",
      tile: "#343434",
      border: "#2e2e2e",
      text: "#ffffff",
      dim: "#a8a8a8",
      faint: "#767676",
      rail: "#000000",
      railFg: "#ffffff",
      railDim: "#5e5e5e",
      railTile: "#1f1f1f",
      railBorder: "#000000",
      accent: "#f5f5f5",
      accent2: "#ff2f2f",
      onAccent: "#0d0d0d",
      accentFg: "#f5f5f5",
      danger: "#ff2f2f",
      canvasA: "#1f1f1f",
      canvasB: "#131313",
      wash: "linear-gradient(180deg, rgba(255,255,255,.04), rgba(0,0,0,.36) 45%, rgba(0,0,0,.5))",
    },
  },

  {
    id: "guardbase",
    name: "Guardbase",
    audience: "esports clans · moderation & ops crews",
    note: "4px cut corners · Rajdhani condensed caps · steel HUD veil, bar-marked selection",
    skin: skin({
      font: FONTS.rajdhani,
      track: ".02em",
      caps: "uppercase",
      weight: 600,
      radiusSm: "3px",
      radiusMd: "4px",
      radiusLg: "4px",
      radiusXl: "8px",
      radiusRail: "6px",
      radiusAvatar: "6px",
      glass: 0.2,
      blurPx: 18,
      selectionBar: true,
    }),
    light: {
      app: "#e4ecf1",
      windowBg: "linear-gradient(160deg,#eef4f8,#dde8ee)",
      bar: "#e8f0f5",
      side: "#e2ebf1",
      surface: "#f4f9fb",
      header: "#ecf3f7",
      chip: "#cfdce4",
      input: "#eef5f8",
      tile: "#bccdd8",
      border: "#c7d5de",
      text: "#0b1a24",
      dim: "#32505f",
      faint: "#5a7484",
      rail: "#1b2c38",
      railFg: "#c4d5df",
      railDim: "#71889a",
      railTile: "#2c4353",
      railBorder: "#2c4353",
      accent: "#1c5f85",
      accent2: "#5f7c8c",
      accentOnRail: "#79b3d6",
      canvasA: "#e2edf2",
      canvasB: "#cedde6",
      wash: "linear-gradient(180deg, rgba(31,107,147,.06), rgba(244,249,251,.62) 45%, rgba(244,249,251,.8))",
    },
    dark: {
      app: "#0f161b",
      windowBg: "linear-gradient(160deg,#121b21,#0b1015)",
      bar: "#0e161c",
      side: "#141d24",
      surface: "#182229",
      header: "#162027",
      chip: "#223039",
      input: "#121b22",
      tile: "#2a3c47",
      border: "#22323b",
      text: "#dfe9f0",
      dim: "#90a6b4",
      faint: "#66798a",
      rail: "#080e12",
      railFg: "#b4c8d4",
      railDim: "#5a6d7c",
      railTile: "#18242c",
      railBorder: "#18242c",
      accent: "#5fb0e0",
      accent2: "#8aa6b6",
      onAccent: "#04141f",
      canvasA: "#1a262f",
      canvasB: "#0e161c",
      wash: "linear-gradient(180deg, rgba(95,176,224,.09), rgba(3,7,10,.38) 45%, rgba(3,7,10,.52))",
    },
  },

  {
    id: "aurora",
    name: "Aurora",
    audience: "modern glassmorphic · showcase / new users",
    note: "22px glass · Outfit · translucent panels floating on an aurora mesh, 40px blur",
    skin: skin({
      font: FONTS.outfit,
      radiusSm: "12px",
      radiusMd: "16px",
      radiusLg: "20px",
      radiusXl: "24px",
      radiusRail: "16px",
      glass: 0.55,
      blurPx: 40,
    }),
    light: {
      app: "#eef1f8",
      windowBg:
        "radial-gradient(70% 60% at 8% 0%, #9fd4ff 0%, rgba(159,212,255,0) 60%), radial-gradient(65% 55% at 95% 10%, #ffc9e6 0%, rgba(255,201,230,0) 62%), radial-gradient(80% 70% at 60% 100%, #b8ffe4 0%, rgba(184,255,228,0) 62%), linear-gradient(150deg,#f4f7ff,#e7ecf8)",
      bar: "#ffffff",
      side: "#ffffff",
      surface: "#ffffff",
      header: "#ffffff",
      card: "#ffffff",
      chip: "#e9edf6",
      input: "#ffffff",
      tile: "#cfd8ea",
      border: "#c9d3e6",
      text: "#12203a",
      dim: "#4a5a78",
      faint: "#7c8aa5",
      rail: "#ffffff",
      railFg: "#3a4a68",
      railDim: "#94a1b8",
      railTile: "#e3e9f5",
      accent: "#2a6df0",
      accent2: "#8a5cf0",
      gifBg: "#e6ecfb",
      gifFg: "#2a55b5",
      canvasA: "#e9f0fd",
      canvasB: "#dde6f8",
      wash: "linear-gradient(180deg, rgba(42,109,240,.05), rgba(255,255,255,.5) 45%, rgba(255,255,255,.7))",
    },
    dark: {
      app: "#0a0f1c",
      windowBg:
        "radial-gradient(70% 60% at 8% 0%, #123f7a 0%, rgba(18,63,122,0) 60%), radial-gradient(65% 55% at 95% 8%, #5a1a63 0%, rgba(90,26,99,0) 62%), radial-gradient(80% 70% at 60% 100%, #0d5c53 0%, rgba(13,92,83,0) 62%), linear-gradient(150deg,#0c1120,#070a13)",
      bar: "#1a2438",
      side: "#1a2438",
      surface: "#1c2740",
      header: "#1a2438",
      card: "#1e2a44",
      chip: "#2c3a58",
      input: "#22304c",
      tile: "#33436a",
      border: "#3a4a70",
      text: "#eaf1ff",
      dim: "#a3b4d2",
      faint: "#7385a6",
      rail: "#1a2438",
      railFg: "#c3d2ee",
      railDim: "#6d7d9c",
      railTile: "#28354f",
      railBorder: "#33425f",
      accent: "#7fb0ff",
      accent2: "#b795ff",
      onAccent: "#06142e",
      gifBg: "#2c3a58",
      gifFg: "#a9c4f0",
      canvasA: "#16233c",
      canvasB: "#0b1120",
      wash: "linear-gradient(180deg, rgba(127,176,255,.09), rgba(4,7,14,.34) 45%, rgba(4,7,14,.48))",
    },
  },
];

const BY_ID = new Map(NEBULA_THEMES.map((theme) => [theme.id, theme]));

export function isNebulaThemeId(value: unknown): value is NebulaThemeId {
  return typeof value === "string" && BY_ID.has(value as NebulaThemeId);
}

/** The sheet's definition for a theme, or null for an id it does not draw. */
export function nebulaThemeDef(id: string | null | undefined): NebulaThemeDef | null {
  return id ? (BY_ID.get(id as NebulaThemeId) ?? null) : null;
}
