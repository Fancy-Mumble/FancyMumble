/**
 * Nebula's MUI theme.
 *
 * Nebula is built on MUI 9, so the mock's look has to live in the theme rather
 * than in a stylesheet: every surface, hairline and radius the design repeats
 * is encoded once here as a component default, and screens then compose plain
 * MUI components without restating the same `sx` block. The mock's raw tokens
 * ride along on `palette.nebula` for the handful of places (glows, tints,
 * gradients) that have no MUI palette slot.
 */
import { createTheme, alpha, type Theme } from "@mui/material/styles";
import { over } from "@shared/profilecard";
import { liveryTokens, type ServerLivery } from "./livery";
import { DEFAULT_SKIN, type NebulaSkin } from "./themeCatalog";
import {
  NEBULA_MONO,
  NEBULA_SANS,
  NEBULA_TOKENS,
  radius,
  type NebulaMode,
  type NebulaTokens,
} from "./tokens";

declare module "@mui/material/styles" {
  interface Palette {
    nebula: NebulaTokens;
    /** The theme's shape, type voice and glass - see `themeCatalog.ts`. */
    nebulaSkin: NebulaSkin;
  }
  interface PaletteOptions {
    nebula: NebulaTokens;
    nebulaSkin: NebulaSkin;
  }
}

/** The mock sizes everything against a 13px root, not MUI's 16px. */
const BASE_FONT_SIZE = 13;

/**
 * The scheme, restated as Standard's custom properties.
 *
 * Nebula borrows a good deal of Standard - the markdown composer, the emoji and
 * GIF pickers, the mention list, the file preview - and every one of those is
 * painted by `--color-*` off the cascade rather than by `palette.nebula`. Left
 * alone they wear whichever Standard stylesheet `data-theme` selected, which
 * was merely a near-miss before and is now a plain contradiction: a theme can
 * be worn in either scheme, and Standard's stylesheet only has the one.
 *
 * So the pack publishes its own answer over the top. Only the properties those
 * borrowed surfaces actually read are restated - the rest of the theme file
 * still shows through, which is what keeps this a bridge rather than a second
 * theme system.
 *
 * Written under `:root:root` so it outranks the theme file's `[data-theme=…]`
 * block whatever order the two stylesheets end up in.
 */
function standardVariables(t: NebulaTokens): Record<string, string> {
  const surface = over(t.card, t.bg0);
  return {
    "--color-bg-primary": t.bg0,
    "--color-bg-secondary": over(t.panel, t.bg0),
    "--color-bg-elevated": surface,
    "--color-surface": surface,
    "--color-bg-deepest": t.bg0,
    "--color-surface-titlebar": over(t.bar, t.bg0),
    "--color-surface-action-bar": over(t.header, t.bg0),
    "--color-surface-toast": surface,

    "--color-text-primary": t.text,
    "--color-text-secondary": t.muted,
    "--color-text-muted": t.dim,
    "--color-text-button": t.muted,
    "--color-text-placeholder": t.dim,
    "--color-text-on-accent": t.onAccent,

    "--color-accent": t.accent,
    "--color-accent-hover": t.accent,
    "--color-accent-bright": t.accentText,
    "--color-accent-soft": t.accentSoft,
    "--color-accent-subtle": t.accentSoft,
    "--color-accent-light": t.accentSoft,
    "--color-accent-medium": t.accentSoft,
    "--color-accent-strong": t.accentLine,
    "--color-accent-fill": t.accentLine,
    "--color-accent-border": t.accentLine,
    "--color-accent-border-strong": t.accentLine,
    "--color-accent-selection": t.accentSoft,
    "--color-accent-glow": t.accentLine,
    "--color-link": t.accentText,
    "--color-purple": t.accent2,

    "--color-glass": t.card,
    "--color-glass-subtle": t.card,
    "--color-glass-hover": t.hover,
    "--color-glass-medium": t.card2,
    "--color-glass-active": t.accentSoft,
    "--color-glass-strong": t.card2,
    "--color-glass-heavy": t.card2,
    "--color-glass-border": t.line,
    "--color-glass-border-hover": t.line2,

    "--color-danger": t.bad,
    "--color-danger-alt": t.bad,
    "--color-warning": t.warn,
    "--color-warning-amber": t.warn,
    "--color-online": t.ok,

    "--color-scrollbar": t.card2,
    "--color-scrollbar-hover": t.line2,
  };
}

/** Input types the baseline must not touch - they are not text surfaces. */
const UNSTYLED_INPUT_TYPES = [
  '[type="checkbox"]',
  '[type="radio"]',
  '[type="range"]',
  '[type="file"]',
  '[type="color"]',
  '[type="submit"]',
  '[type="button"]',
  '[type="image"]',
  '[type="reset"]',
].join(", ");

/**
 * Nebula's MUI theme for one scheme.
 *
 * `base` is where the user's colour theme arrives: `themeTokens` renders the
 * stylesheet on `<html>` into this pack's tokens, and passing nothing keeps the
 * mock's own - which is what the two neutral themes, and every test, want.
 */
export function createNebulaTheme(
  mode: NebulaMode,
  base?: NebulaTokens | null,
  livery?: ServerLivery | null,
  skin: NebulaSkin = DEFAULT_SKIN,
): Theme {
  // Last, and on top of whatever the app resolved: a server's colours are the
  // most specific statement about this window. Whether one is passed at all is
  // the caller's decision, which is where the user's own "use this server's
  // colours" switch lives - livery is a suggestion, never a mandate.
  const nebula = liveryTokens(base ?? NEBULA_TOKENS[mode], livery ?? null, mode);
  // The theme's own typeface, unless the user named one in Personalization -
  // an explicit choice outranks a skin's suggestion, and `--font-family` is
  // where that choice lands.
  const sans = `var(--font-family, ${skin.font})`;

  return createTheme({
    palette: {
      mode,
      nebula,
      nebulaSkin: skin,
      // The scheme's own ink, never a hardcoded white: Midnight's accent is
      // acid yellow and Mobel's is ochre, and white on either is unreadable.
      // Everything MUI paints on `primary` - filled buttons above all - reads
      // this, which is why it is the one place the pairing is stated.
      primary: { main: nebula.accent, contrastText: nebula.onAccent },
      success: { main: nebula.ok },
      error: { main: nebula.bad },
      warning: { main: nebula.warn },
      background: { default: nebula.bg0, paper: nebula.bg0 },
      text: { primary: nebula.text, secondary: nebula.muted, disabled: nebula.dim },
      divider: nebula.line,
    },
    // MUI's own scalar, kept in step with the skin so any component that
    // has not been given an explicit radius still lands on the theme's step.
    shape: { borderRadius: Number.parseInt(skin.radiusMd, 10) || 0 },
    typography: {
      fontFamily: sans,
      fontSize: BASE_FONT_SIZE,
      htmlFontSize: 16,
      // The mock's type is a small, tight set rather than a full scale: a
      // screen title, a row title, body copy, and two caption weights.
      h1: { fontSize: 23, fontWeight: 700, lineHeight: 1.2 },
      h2: { fontSize: 20, fontWeight: 600, lineHeight: 1.25 },
      h3: { fontSize: 15, fontWeight: 600, lineHeight: 1.3 },
      subtitle1: { fontSize: 13, fontWeight: 600, lineHeight: 1.35 },
      subtitle2: { fontSize: 12.5, fontWeight: 600, lineHeight: 1.35 },
      // Tracking and base weight are the skin's, so a condensed caps theme
      // (Guardbase, Midnight) reads as one and a serif theme does not get
      // letter-spacing it never asked for.
      allVariants: { letterSpacing: skin.track },
      body1: { fontSize: 13, lineHeight: 1.55, fontWeight: skin.weight },
      body2: { fontSize: 12, lineHeight: 1.5, fontWeight: skin.weight },
      caption: { fontSize: 11, lineHeight: 1.45, color: nebula.muted },
      // Reserved for the mock's tracked-out section labels ("JOIN AS").
      overline: {
        fontSize: 10.5,
        fontWeight: 600,
        letterSpacing: "0.1em",
        lineHeight: 1.4,
        color: nebula.dim,
      },
      button: { fontSize: 12, fontWeight: 500, textTransform: "none" },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          ":root": {
            colorScheme: mode,
            // The one place the scale is given a value. Everything below -
            // component defaults and screens alike - reads the variable, which
            // is what lets a theme restate the whole corner language in six
            // numbers and have every rounded thing in the pack follow.
            "--nebula-radius-sm": skin.radiusSm,
            "--nebula-radius-md": skin.radiusMd,
            "--nebula-radius-lg": skin.radiusLg,
            "--nebula-radius-xl": skin.radiusXl,
            "--nebula-radius-rail": skin.radiusRail,
            "--nebula-radius-avatar": skin.radiusAvatar,
            // The theme's own face, for the "system default" font setting to
            // fall through to. See `applyFont`.
            "--nebula-font": skin.font,
            // How far the chrome blurs what is behind it: 0 for the opaque
            // skins, 40px for Aurora. `glassChrome` and friends read it.
            "--nebula-blur": skin.glass ? `${skin.blurPx}px` : "0px",
            "--nebula-clip-window": skin.clipWindow,
            "--nebula-clip-selection": skin.clipSelection,
            "--nebula-clip-bubble": skin.clipBubble,
          },
          // The borrowed-Standard bridge. Doubled selector so it wins against
          // the theme file's own `[data-theme=…]` block; see the note above.
          ":root:root": standardVariables(nebula),
          body: {
            margin: 0,
            fontFamily: sans,
            fontSize: BASE_FONT_SIZE,
            // The main window is transparent and undecorated, so the page must
            // not paint an opaque rectangle behind the shell - the shell's own
            // rounded corners are the window's corners, and anything painted
            // here would square them off again.
            background: "transparent",
            color: nebula.text,
          },
          /*
           * A baseline for bare form controls.
           *
           * Nebula borrows Standard's pickers but deliberately does not load
           * Standard's global.css, whose own "form control baseline" is what
           * stops half-styled controls drifting. Without an equivalent here,
           * every borrowed widget that leaves an input to the host - the emoji
           * picker's search box among them - rendered as a raw browser input
           * in the middle of the mock.
           *
           * MUI's own fields do not go through these selectors, so this only
           * catches the controls nobody styled, which is exactly its job. A
           * single class still wins, as a baseline must.
           */
          [`input:where(:not(${UNSTYLED_INPUT_TYPES})), textarea:where(:not([class*="Mui"])), select`]: {
            padding: "8px 12px",
            borderRadius: radius("sm"),
            border: `1px solid ${nebula.line2}`,
            background: nebula.input,
            color: nebula.text,
            fontFamily: "inherit",
            fontSize: "inherit",
            lineHeight: 1.4,
            outline: "none",
          },
          [`input:where(:not(${UNSTYLED_INPUT_TYPES}))::placeholder, textarea::placeholder`]: {
            color: nebula.muted,
          },
          /*
           * An outline rather than a border swap: it cannot reflow the layout
           * and it survives forced-colours modes.
           *
           * `:focus-visible` is inside `:where()` so this stays a zero-weight
           * element selector. Written plainly it outranks a component's own
           * `outline: none` - which is how the markdown editor, whose wrapper
           * clips overflow, ended up drawing four corner specks on focus.
           */
          [`input:where(:not(${UNSTYLED_INPUT_TYPES})):where(:focus-visible), textarea:where(:focus-visible), select:where(:focus-visible)`]:
            {
              outline: `2px solid ${nebula.accent}`,
              outlineOffset: 1,
            },
          // The mock's scrollbars are part of its surface language, not an
          // afterthought - thin, track-less, and the same tone as a chip.
          "*": { scrollbarWidth: "thin", scrollbarColor: `${nebula.card2} transparent` },
          "*::-webkit-scrollbar": { width: 9, height: 9 },
          "*::-webkit-scrollbar-track": { background: "transparent" },
          "*::-webkit-scrollbar-thumb": {
            background: nebula.card2,
            borderRadius: radius("md"),
            border: "2px solid transparent",
            backgroundClip: "padding-box",
          },
          "*::-webkit-scrollbar-thumb:hover": { background: nebula.line2 },
          "*::-webkit-scrollbar-corner": { background: "transparent" },
        },
      },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: {
            backgroundColor: "transparent",
            backgroundImage: "none",
            color: nebula.text,
          },
          // Floating surfaces (menus, dialogs, popovers) all share one recipe
          // in the mock: the tint wash over the window colour, a stronger
          // hairline, and the long soft shadow.
          rounded: { borderRadius: radius("lg") },
        },
      },
      MuiButtonBase: { defaultProps: { disableRipple: true } },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { borderRadius: radius("md"), minWidth: 0, padding: "6px 13px", fontWeight: 500 },
          contained: {
            backgroundColor: nebula.accent,
            color: nebula.onAccent,
            boxShadow: `0 4px 14px ${alpha(nebula.accent, 0.4)}`,
            "&:hover": { backgroundColor: nebula.accent, filter: "brightness(1.08)" },
          },
          outlined: {
            borderColor: nebula.line2,
            color: nebula.text,
            "&:hover": { borderColor: nebula.line2, backgroundColor: nebula.hover },
          },
          text: {
            color: nebula.muted,
            "&:hover": { backgroundColor: nebula.hover, color: nebula.text },
          },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: {
            borderRadius: radius("md"),
            color: nebula.muted,
            padding: 7,
            "&:hover": { backgroundColor: nebula.hover, color: nebula.text },
          },
          sizeSmall: { padding: 5 },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            height: "auto",
            borderRadius: radius("lg"),
            backgroundColor: nebula.card,
            border: `1px solid ${nebula.line}`,
            fontSize: 11,
            fontWeight: 500,
          },
          label: { padding: "3px 9px" },
          outlined: { backgroundColor: "transparent" },
        },
      },
      MuiDivider: { styleOverrides: { root: { borderColor: nebula.line } } },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: radius("md"),
            padding: "10px 12px",
            color: nebula.muted,
            gap: 10,
            "&:hover": { backgroundColor: nebula.hover },
            "&.Mui-selected": {
              backgroundColor: nebula.card,
              border: `1px solid ${nebula.line}`,
              color: nebula.text,
              "&:hover": { backgroundColor: nebula.card },
            },
          },
        },
      },
      MuiMenu: {
        styleOverrides: {
          paper: {
            minWidth: 210,
            borderRadius: radius("lg"),
            padding: 5,
            background: `${nebula.tint},${nebula.bg0}`,
            border: `1px solid ${nebula.line2}`,
            boxShadow: nebula.shadow,
            backdropFilter: "blur(16px)",
          },
          list: { padding: 0 },
        },
      },
      MuiMenuItem: {
        styleOverrides: {
          root: {
            borderRadius: radius("md"),
            padding: "8px 10px",
            fontSize: 12.5,
            gap: 9,
            minHeight: 0,
            "&:hover": { backgroundColor: nebula.hover },
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            borderRadius: radius("xl"),
            background: `${nebula.tint},${nebula.bg0}`,
            border: `1px solid ${nebula.line2}`,
            boxShadow: nebula.shadow,
          },
        },
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            backgroundColor: nebula.bg0,
            border: `1px solid ${nebula.line2}`,
            color: nebula.text,
            fontSize: 11,
            borderRadius: radius("md"),
            boxShadow: nebula.shadow,
          },
        },
      },
      MuiInputBase: {
        styleOverrides: {
          root: { fontSize: 12.5, color: nebula.text },
          input: { "&::placeholder": { color: nebula.dim, opacity: 1 } },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: radius("md"),
            // The sheet's `input`, not `card`: a field is a hole in the surface
            // rather than a card raised off it, and several skins colour the
            // two differently - Midnight's near-black field on a steel panel,
            // Aurora's opaque white one on glass.
            backgroundColor: nebula.input,
            "& .MuiOutlinedInput-notchedOutline": { borderColor: nebula.line2 },
            "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: nebula.line2 },
            "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
              borderColor: nebula.accentLine,
              borderWidth: 1,
            },
          },
          input: { padding: "9px 13px" },
        },
      },
      MuiInputLabel: { styleOverrides: { root: { fontSize: 12, fontWeight: 600 } } },
      MuiSwitch: {
        styleOverrides: {
          root: { width: 32, height: 18, padding: 0 },
          switchBase: {
            padding: 2,
            // The thumb rides on the accent track once checked, so it takes the
            // same ink every other filled control does.
            "&.Mui-checked": { transform: "translateX(14px)", color: nebula.onAccent },
            "&.Mui-checked + .MuiSwitch-track": { backgroundColor: nebula.accent, opacity: 1 },
          },
          thumb: { width: 14, height: 14, boxShadow: "none" },
          track: { borderRadius: "999px", backgroundColor: nebula.card2, opacity: 1 },
        },
      },
      MuiSlider: {
        styleOverrides: {
          root: { height: 4, padding: "10px 0" },
          rail: { backgroundColor: nebula.card2, opacity: 1 },
          track: { border: "none" },
          thumb: {
            width: 12,
            height: 12,
            // The knob sits on the accent-filled track; a white one disappears
            // into a light scheme and glares in Ply's black one.
            backgroundColor: nebula.onAccent,
            boxShadow: "0 1px 3px rgba(0,0,0,.35)",
            "&:hover,&.Mui-focusVisible": { boxShadow: "0 1px 3px rgba(0,0,0,.35)" },
          },
        },
      },
      MuiAvatar: { styleOverrides: { root: { fontSize: 12, fontWeight: 600 } } },
      MuiBadge: { styleOverrides: { badge: { fontSize: 9.5, fontWeight: 600 } } },
      MuiLinearProgress: {
        styleOverrides: {
          root: { height: 3, backgroundColor: nebula.card2 },
          bar: { backgroundColor: nebula.accent },
        },
      },
      MuiTypography: { styleOverrides: { root: { fontFamily: "inherit" } } },
    },
  });
}

/**
 * The chrome that floats over the conversation: the channel header and the
 * composer.
 *
 * `backdrop-filter` only reads as glass when something varied sits behind it -
 * over a flat fill it is indistinguishable from a plain tint, which is why the
 * conversation backdrop always paints a textured wash.
 *
 * There is deliberately no opaque fallback for webviews that cannot blur
 * (WebKitGTK parses the property and never renders it). Nothing scrolls behind
 * this chrome - only the backdrop gradient does - so there is nothing to
 * obscure, and an opaque fallback would turn the bar into exactly the flat slab
 * the translucency exists to avoid. Blur is a refinement here, not the effect.
 */
/**
 * A surface with a stroke that survives a chamfer.
 *
 * `clip-path` cuts the border off with the box, so a chamfered card drawn the
 * ordinary way loses its outline on exactly the two corners the theme cut -
 * which is what "you forgot the border" is. The stroke is therefore painted:
 * the element's own background *is* the line, and an inset pseudo-element one
 * pixel in carries the fill. Both are clipped, so the line follows the cut.
 *
 * The same recipe is correct for the skins that cut nothing - a 1px inset fill
 * over a line-coloured ground is a 1px border - so there is one path rather
 * than a chamfered branch and a bordered one.
 */
export function chamferedSurface(theme: Theme, fill: string, line: string) {
  const { nebula } = theme.palette;
  return {
    position: "relative",
    // Keeps the negative z-index below inside this card rather than letting it
    // fall behind whatever the card is sitting on.
    isolation: "isolate",
    clipPath: "var(--nebula-clip-bubble, none)",
    background: line || nebula.line2,
    border: "none",
    "&::before": {
      content: '""',
      position: "absolute",
      inset: "1px",
      zIndex: -1,
      background: fill,
      borderRadius: "inherit",
      clipPath: "var(--nebula-clip-bubble, none)",
    },
  } as const;
}

export function glassChrome(theme: Theme) {
  const { nebula } = theme.palette;
  return {
    // The channel header and the composer are the sheet's `header`, not its
    // `side` - several skins tint the two differently, and sharing one token
    // was what flattened them into a single band.
    background: nebula.header,
    // How far a panel blurs is the skin's, not a constant: an opaque skin must
    // not blur at all, and Aurora blurs at 40px. `--nebula-blur` carries it.
    WebkitBackdropFilter: "blur(var(--nebula-blur, 14px)) saturate(1.15)",
    backdropFilter: "blur(var(--nebula-blur, 14px)) saturate(1.15)",
  } as const;
}

/**
 * The glass a panel that hangs over the conversation is cut from.
 *
 * `floatingSurface` paints the scheme's own colour, which is right for a menu
 * sitting on the window; this is for the surfaces that float over the
 * wallpaper, where what is behind them is the point. One recipe rather than
 * two, so the composer's popovers and the pinned panel cannot drift apart in
 * blur or hairline.
 */
export function washPanel(theme: Theme) {
  const { nebula } = theme.palette;
  return {
    background: nebula.wash,
    WebkitBackdropFilter: "blur(36px) saturate(160%)",
    backdropFilter: "blur(36px) saturate(160%)",
    border: `1px solid ${nebula.washLine}`,
  } as const;
}

/** Shared recipe for the mock's floating surfaces (menus, cards, panels). */
export function floatingSurface(theme: Theme) {
  const { nebula } = theme.palette;
  return {
    background: `${nebula.tint},${nebula.bg0}`,
    border: `1px solid ${nebula.line2}`,
    boxShadow: nebula.shadow,
  } as const;
}

export { NEBULA_MONO, NEBULA_SANS };
