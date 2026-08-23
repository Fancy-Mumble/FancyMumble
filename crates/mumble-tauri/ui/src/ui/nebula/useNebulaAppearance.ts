/**
 * Keeps the Nebula theme in step with the app-wide colour theme.
 *
 * Colour themes are independent of UI packs, so Nebula cannot ship only the
 * mock's two schemes and ignore the eleven the user can pick from. It reads the
 * active theme's window background off `:root` and uses it to choose a light or
 * dark Nebula scheme.
 *
 * Only the *mode* follows the app theme. Nebula keeps its own accent and
 * surface language, because those are what make it a distinct design rather
 * than Standard with different spacing - a theme's accent would repaint the
 * pack into something the mock never described.
 */
import { useEffect, useMemo, useState } from "react";
import type { Theme } from "@mui/material/styles";
import { liveryColourAllowed, type ServerLivery } from "./livery";
import { createNebulaTheme } from "./theme";
import type { NebulaMode } from "./tokens";

interface Appearance {
  mode: NebulaMode;
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

function readAppearance(): Appearance {
  if (typeof globalThis.getComputedStyle !== "function") return { mode: "dark" };
  const style = globalThis.getComputedStyle(document.documentElement);
  return { mode: resolveMode(style.getPropertyValue("--color-bg-primary").trim()) };
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
  const [appearance, setAppearance] = useState<Appearance>(() => ({ mode: "dark" }));

  useEffect(() => {
    const sync = () =>
      setAppearance((current) => {
        const next = readAppearance();
        return current.mode === next.mode ? current : next;
      });
    sync();
    // `applyTheme` swaps a single attribute on `<html>`; the computed variables
    // only settle once that stylesheet applies, so observe rather than poll.
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  const allowed = livery && liveryColourAllowed() ? livery : null;
  // Keyed on the version rather than the object: the document is rebuilt on
  // every state sync, and rebuilding the theme with it would repaint the window
  // on traffic that changed no colour.
  return useMemo(
    () => createNebulaTheme(appearance.mode, undefined, allowed),
    [appearance.mode, allowed?.version, allowed === null],
  );
}
