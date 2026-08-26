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
import { liveryTokens, type ServerLivery } from "./livery";
import {
  NEBULA_MONO,
  NEBULA_RADIUS,
  NEBULA_SANS,
  NEBULA_TOKENS,
  radius,
  type NebulaMode,
  type NebulaTokens,
} from "./tokens";

declare module "@mui/material/styles" {
  interface Palette {
    nebula: NebulaTokens;
  }
  interface PaletteOptions {
    nebula: NebulaTokens;
  }
}

/** The mock sizes everything against a 13px root, not MUI's 16px. */
const BASE_FONT_SIZE = 13;

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

export function createNebulaTheme(
  mode: NebulaMode,
  accentOverride?: string,
  livery?: ServerLivery | null,
): Theme {
  const base = NEBULA_TOKENS[mode];
  const withAccent: NebulaTokens = accentOverride
    ? {
        ...base,
        accent: accentOverride,
        accentSoft: alpha(accentOverride, mode === "dark" ? 0.22 : 0.12),
        accentLine: alpha(accentOverride, mode === "dark" ? 0.52 : 0.34),
      }
    : base;

  // Last, and on top of whatever the app resolved: a server's colours are the
  // most specific statement about this window. Whether one is passed at all is
  // the caller's decision, which is where the user's own "use this server's
  // colours" switch lives - livery is a suggestion, never a mandate.
  const nebula = liveryTokens(withAccent, livery ?? null, mode);

  return createTheme({
    palette: {
      mode,
      nebula,
      primary: { main: nebula.accent, contrastText: "#ffffff" },
      success: { main: nebula.ok },
      error: { main: nebula.bad },
      warning: { main: nebula.warn },
      background: { default: nebula.bg0, paper: nebula.bg0 },
      text: { primary: nebula.text, secondary: nebula.muted, disabled: nebula.dim },
      divider: nebula.line,
    },
    shape: { borderRadius: NEBULA_RADIUS.md },
    typography: {
      fontFamily: NEBULA_SANS,
      fontSize: BASE_FONT_SIZE,
      htmlFontSize: 16,
      // The mock's type is a small, tight set rather than a full scale: a
      // screen title, a row title, body copy, and two caption weights.
      h1: { fontSize: 23, fontWeight: 700, lineHeight: 1.2 },
      h2: { fontSize: 20, fontWeight: 600, lineHeight: 1.25 },
      h3: { fontSize: 15, fontWeight: 600, lineHeight: 1.3 },
      subtitle1: { fontSize: 13, fontWeight: 600, lineHeight: 1.35 },
      subtitle2: { fontSize: 12.5, fontWeight: 600, lineHeight: 1.35 },
      body1: { fontSize: 13, lineHeight: 1.55 },
      body2: { fontSize: 12, lineHeight: 1.5 },
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
            // component defaults and screens alike - reads the variable.
            "--nebula-radius-sm": `${NEBULA_RADIUS.sm}px`,
            "--nebula-radius-md": `${NEBULA_RADIUS.md}px`,
            "--nebula-radius-lg": `${NEBULA_RADIUS.lg}px`,
            "--nebula-radius-xl": `${NEBULA_RADIUS.xl}px`,
          },
          body: {
            margin: 0,
            fontFamily: NEBULA_SANS,
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
            background: nebula.card2,
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
            color: "#fff",
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
            backgroundColor: nebula.card,
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
            "&.Mui-checked": { transform: "translateX(14px)", color: "#fff" },
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
            backgroundColor: "#fff",
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
export function glassChrome(theme: Theme) {
  const { nebula } = theme.palette;
  return {
    background: nebula.panel,
    WebkitBackdropFilter: "blur(14px)",
    backdropFilter: "blur(14px)",
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
