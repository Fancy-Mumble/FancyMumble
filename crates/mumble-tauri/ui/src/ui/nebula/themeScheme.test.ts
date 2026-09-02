import { describe, expect, it } from "vitest";
import { contrast, parseHex } from "./livery";
import { NEBULA_THEMES, nebulaThemeDef, type NebulaThemeId } from "./themeCatalog";
import { nebulaScheme, schemeSwatches } from "./themeScheme";
import type { NebulaMode, NebulaTokens } from "./tokens";
import { THEMES as STANDARD_THEMES } from "@standard/themes";

/** The colour slots, as opposed to the gradients and the shadow. */
const COLOUR_KEYS = [
  "bg0",
  "bar",
  "barText",
  "barDim",
  "barFaint",
  "panel",
  "header",
  "card",
  "cardEdge",
  "card2",
  "input",
  "tile",
  "line",
  "line2",
  "hover",
  "text",
  "muted",
  "dim",
  "accent",
  "accentText",
  "accent2",
  "accentOnRail",
  "onAccent",
  "accentSoft",
  "accentLine",
  "ok",
  "bad",
  "warn",
  "rail",
  "railEdge",
  "railText",
  "railDim",
  "railTile",
  "railLine",
  "gifBg",
  "gifText",
] as const satisfies readonly (keyof NebulaTokens)[];

function ratio(one: string, other: string): number {
  const first = parseHex(one);
  const second = parseHex(other);
  if (!first || !second) throw new Error(`not a hex pair: ${one} / ${other}`);
  return contrast(first, second);
}

const MODES: NebulaMode[] = ["light", "dark"];

describe("the design sheet's catalog", () => {
  it("draws twelve skins", () => {
    expect(NEBULA_THEMES).toHaveLength(12);
    expect(new Set(NEBULA_THEMES.map((theme) => theme.id)).size).toBe(12);
  });

  it("covers every colour theme Standard offers", () => {
    // The picker lists one row per theme. A Standard theme with no entry here
    // would fall through to the CSS derivation and quietly lose its corner
    // language and typeface, which is the gap this catalog exists to close.
    for (const theme of STANDARD_THEMES) {
      expect(nebulaThemeDef(theme.id), theme.id).not.toBeNull();
    }
  });

  for (const def of NEBULA_THEMES) {
    describe(def.id, () => {
      for (const mode of MODES) {
        describe(mode, () => {
          const scheme = nebulaScheme(def.id, mode)!;
          const t = scheme.tokens;

          it("resolves every token to something CSS can take", () => {
            for (const [key, value] of Object.entries(t)) {
              expect(value, key).toBeTruthy();
              expect(value, key).not.toMatch(/undefined|NaN/);
            }
            for (const key of COLOUR_KEYS) {
              expect(t[key], key).toMatch(/^(#[0-9a-f]{3,8}|rgba?\()/i);
            }
          });

          it("keeps the three text rungs readable on the window", () => {
            expect(ratio(t.text, t.bg0)).toBeGreaterThanOrEqual(4.5);
            expect(ratio(t.muted, t.bg0)).toBeGreaterThanOrEqual(3);
            expect(ratio(t.dim, t.bg0)).toBeGreaterThanOrEqual(2);
          });

          it("keeps the title bar's own rungs readable on the bar", () => {
            // Midnight and Mobel invert the bar against the window, which is
            // exactly why the bar carries its own three rungs rather than
            // borrowing the window's.
            const bar = mode === "dark" ? (def.dark.bar ?? def.dark.app) : (def.light.bar ?? def.light.app);
            expect(ratio(t.barText, bar)).toBeGreaterThanOrEqual(4.5);
            expect(ratio(t.barDim, bar)).toBeGreaterThanOrEqual(2.5);
          });

          it("keeps the rail's own rungs readable on the rail", () => {
            const rail = mode === "dark" ? def.dark.rail : def.light.rail;
            expect(ratio(t.railText, rail)).toBeGreaterThanOrEqual(4);
            expect(ratio(t.railDim, rail)).toBeGreaterThanOrEqual(2);
          });

          it("puts legible ink on a filled accent", () => {
            expect(ratio(t.onAccent, t.accent)).toBeGreaterThanOrEqual(3.5);
          });

          it("keeps the destructive and caution states above the component floor", () => {
            expect(ratio(t.bad, t.bg0)).toBeGreaterThanOrEqual(3);
            expect(ratio(t.warn, t.bg0)).toBeGreaterThanOrEqual(3);
          });

          it("layers the conversation backdrop over its own gradient", () => {
            expect(t.backdrop).toContain("linear-gradient(165deg");
            expect(t.backdrop.match(/gradient\(/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
          });

          it("gives the window mesh a stackable value", () => {
            // Only the last layer of a `background` shorthand may carry a
            // colour, and several palettes state a flat one.
            expect(t.window === "none" || t.window.includes("gradient(")).toBe(true);
          });

          it("offers four distinct swatches for the picker", () => {
            const swatches = schemeSwatches(scheme);
            expect(swatches).toHaveLength(4);
            for (const swatch of swatches) expect(swatch).toMatch(/^(#[0-9a-f]{3,8}|rgba?\()/i);
          });
        });
      }

      it("wears the glass the sheet asked for", () => {
        const { glass } = def.skin;
        expect(glass).toBeGreaterThanOrEqual(0);
        expect(glass).toBeLessThanOrEqual(0.6);
        // `pan()` turns chrome translucent exactly when the skin says glass.
        const chrome = nebulaScheme(def.id, "dark")!.tokens.panel;
        expect(chrome.startsWith("rgba("), `${def.id} panel`).toBe(glass > 0);
      });

      it("states a complete corner language", () => {
        for (const step of ["radiusSm", "radiusMd", "radiusLg", "radiusXl", "radiusRail"] as const) {
          expect(def.skin[step], step).toMatch(/^\d+(px)?$|^999px$/);
        }
      });

      it("names a typeface with a bundled fallback", () => {
        // Only Inter, Roboto and Space Mono ship with the app, so every stack
        // has to end somewhere the machine can actually render.
        expect(def.skin.font).toMatch(/(Inter|Roboto|Space Mono|Georgia|system-ui|monospace|serif)/);
      });
    });
  }
});

describe("nebulaScheme", () => {
  it("gives each theme two genuinely different schemes", () => {
    for (const def of NEBULA_THEMES) {
      const light = nebulaScheme(def.id, "light")!;
      const dark = nebulaScheme(def.id, "dark")!;
      expect(light.tokens.bg0, def.id).not.toBe(dark.tokens.bg0);
    }
  });

  it("gives each theme a palette of its own", () => {
    // The complaint this whole change answers: picking a theme has to move
    // more than one bit.
    const windows = NEBULA_THEMES.map((def) => nebulaScheme(def.id, "dark")!.tokens.bg0);
    expect(new Set(windows).size).toBe(windows.length);
  });

  it("declines a theme the sheet does not draw", () => {
    expect(nebulaScheme("clarimol", "dark")).toBeNull();
    expect(nebulaScheme(null, "dark")).toBeNull();
    expect(nebulaScheme(undefined, "light")).toBeNull();
  });

  it("carries the sheet's own values through untouched", () => {
    // Spot check against `themeCatalog.ts`, which is itself the transcription:
    // an opaque skin keeps its stated chrome, a glass skin wears it at 1-glass.
    const ply = nebulaScheme("ply" as NebulaThemeId, "dark")!;
    expect(ply.tokens.panel).toBe("#171717");
    expect(ply.tokens.rail).toBe("#000000");
    expect(ply.tokens.bad).toBe("#ff2f2f");

    const rose = nebulaScheme("rose" as NebulaThemeId, "dark")!;
    expect(rose.skin.glass).toBe(0.3);
    expect(rose.tokens.panel).toBe("rgba(36, 20, 40, 0.7)");
    expect(rose.tokens.accent).toBe("#ff56a8");
  });
});
