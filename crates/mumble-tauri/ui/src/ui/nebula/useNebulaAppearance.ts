/**
 * Keeps the Nebula theme in step with the app-wide colour theme.
 *
 * Colour themes are independent of UI packs, so Nebula cannot ship only the
 * mock's two schemes and ignore the eleven the user can pick from. It reads the
 * theme applied to `<html>` - the id, and the custom properties that id brought
 * with it - and renders both into the pack's tokens.
 *
 * The *mode* comes from the theme's window colour; the colours come from
 * `themeTokens`, which keeps Nebula's surface language while wearing the
 * theme's palette. Dark and Light are the exception the module note there
 * explains: those two are Nebula's own.
 */
import { useEffect, useMemo, useState } from "react";
import type { Theme } from "@mui/material/styles";
import { liveryColourAllowed, type ServerLivery } from "./livery";
import { createNebulaTheme } from "./theme";
import { DEFAULT_SKIN, type NebulaSkin } from "./themeCatalog";
import { nebulaScheme } from "./themeScheme";
import { nebulaTokensForTheme, readThemeVars } from "./themeTokens";
import { NEBULA_TOKENS, type NebulaMode, type NebulaTokens } from "./tokens";

interface Appearance {
  mode: NebulaMode;
  tokens: NebulaTokens;
  skin: NebulaSkin;
}

/**
 * The scheme the user asked for.
 *
 * `data-color-mode` is the explicit choice; its absence is "system", which is
 * the platform's. A theme the design sheet does not draw has only one scheme,
 * so for those this answer is discarded in favour of the stylesheet's own
 * window colour - offering a dark Clarimol would offer a thing that does not
 * exist.
 */
function preferredMode(): NebulaMode | null {
  const stated = document.documentElement.getAttribute("data-color-mode");
  if (stated === "light" || stated === "dark") return stated;
  if (typeof globalThis.matchMedia !== "function") return null;
  return globalThis.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/** Whether two token sets describe the same paint. */
function sameTokens(one: NebulaTokens, other: NebulaTokens): boolean {
  return (Object.keys(one) as (keyof NebulaTokens)[]).every((key) => one[key] === other[key]);
}

/**
 * Relative luminance of a theme colour.
 *
 * Custom properties are handed back as authored, so this has to read the theme
 * files' own notation - hex or `rgb()` - rather than the resolved `rgb()` form
 * `getComputedStyle` produces for real properties.
 */
function luminance(color: string): number | null {
  const value = color.trim();
  const channels = (() => {
    const hex = /^#([0-9a-f]{3,8})$/i.exec(value);
    if (hex) {
      const digits = hex[1];
      if (digits.length === 3 || digits.length === 4)
        return [...digits.slice(0, 3)].map((digit) => Number.parseInt(digit + digit, 16));
      if (digits.length === 6 || digits.length === 8)
        return [0, 2, 4].map((offset) => Number.parseInt(digits.slice(offset, offset + 2), 16));
      return null;
    }
    const functional = /^rgba?\(([^)]+)\)$/i.exec(value);
    if (!functional) return null;
    return functional[1]
      .split(/[\s,/]+/)
      .filter(Boolean)
      .slice(0, 3)
      .map((part) => (part.endsWith("%") ? (Number.parseFloat(part) * 255) / 100 : Number.parseFloat(part)));
  })();

  if (!channels || channels.length < 3 || channels.some(Number.isNaN)) return null;
  const [red, green, blue] = channels.map((channel) => channel / 255);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/**
 * Which Nebula scheme a theme's window background calls for.
 *
 * Anything unreadable falls back to dark, which is both the app's default theme
 * and the mock's primary scheme.
 */
export function resolveMode(background: string): NebulaMode {
  const level = background ? luminance(background) : null;
  return level !== null && level > 0.5 ? "light" : "dark";
}

/**
 * The scheme and the tokens the theme now on `<html>` calls for.
 *
 * One read of the cascade, because both answers come out of the same
 * stylesheet: the mode from its window colour, the tokens from the rest of it.
 */
function readAppearance(): Appearance {
  const vars = readThemeVars();
  // Only reached with a stylesheet in force, which is also the only state in
  // which there is a document to ask.
  const themeId = vars ? document.documentElement.getAttribute("data-theme") : null;

  // The design sheet first: it authored both schemes for this theme, including
  // the corner language, the typeface and the glass, so nothing here has to be
  // inferred from a stylesheet that describes none of them.
  const authored = nebulaScheme(themeId, preferredMode() ?? resolveMode(vars?.bg ?? ""));
  if (authored) return { mode: authored.mode, tokens: authored.tokens, skin: authored.skin };

  // Otherwise a colour theme the sheet does not draw - a dormant stylesheet, or
  // one added to Standard since. It has one scheme, its window colour says
  // which, and `themeTokens` renders it into the pack's own shape.
  const mode = resolveMode(vars?.bg ?? "");
  return { mode, tokens: nebulaTokensForTheme(themeId, mode, vars), skin: DEFAULT_SKIN };
}

/**
 * The Nebula theme for the colour theme currently applied to `<html>`, with the
 * open server's livery folded in.
 *
 * Memoised on the livery's version rather than on the object, so a server that
 * republishes an unchanged document does not rebuild the theme, and one that
 * changes a colour does.
 *
 * `null` is the whole of the unbranded path: no livery, no override, and the
 * pack's own tokens reach the theme untouched.
 */
export function useNebulaTheme(livery?: ServerLivery | null): Theme {
  const [appearance, setAppearance] = useState<Appearance>(() => ({
    mode: "dark",
    tokens: NEBULA_TOKENS.dark,
    skin: DEFAULT_SKIN,
  }));

  useEffect(() => {
    const sync = () =>
      setAppearance((current) => {
        const next = readAppearance();
        // Compared token by token rather than by identity: `readAppearance`
        // builds a fresh record every time it runs, and a new object here would
        // rebuild the MUI theme - and repaint the window - on every mutation
        // the observer sees, including the ones that changed no colour.
        return current.mode === next.mode &&
          current.skin === next.skin &&
          sameTokens(current.tokens, next.tokens)
          ? current
          : next;
      });
    sync();
    // `applyTheme` and `applyColorMode` each swap a single attribute on
    // `<html>`; the computed variables only settle once that stylesheet
    // applies, so observe rather than poll.
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-color-mode"],
    });
    // "System" is a live answer, not a stored one: the platform can flip it
    // while the window is open, and a theme drawn in both schemes has to follow.
    const media =
      typeof globalThis.matchMedia === "function"
        ? globalThis.matchMedia("(prefers-color-scheme: light)")
        : null;
    media?.addEventListener("change", sync);
    return () => {
      observer.disconnect();
      media?.removeEventListener("change", sync);
    };
  }, []);

  const allowed = livery && liveryColourAllowed() ? livery : null;
  // Keyed on the version rather than the object: the document is rebuilt on
  // every state sync, and rebuilding the theme with it would repaint the window
  // on traffic that changed no colour.
  return useMemo(
    () => createNebulaTheme(appearance.mode, appearance.tokens, allowed, appearance.skin),
    [appearance.mode, appearance.tokens, appearance.skin, allowed?.version, allowed === null],
  );
}
