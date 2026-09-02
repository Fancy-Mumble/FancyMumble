import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { contrast, parseHex } from "./livery";
import { NEBULA_TOKENS, type NebulaTokens } from "./tokens";
import {
  NATIVE_THEME_IDS,
  THEME_VARIABLES,
  deriveNebulaTokens,
  nebulaTokensForTheme,
  type ThemeVars,
} from "./themeTokens";
import { resolveMode } from "./useNebulaAppearance";

// Vitest runs from the UI package root, and the themes are a fixed part of the
// tree rather than something a bundler resolves.
const THEMES_DIR = resolve(process.cwd(), "src/ui/standard/themes");

/**
 * The bundled themes, read from the stylesheets themselves.
 *
 * The point of this suite is that the derivation holds for the themes that
 * actually ship, not for a fixture written to suit it - a theme file is the
 * input, so a theme file is what the test feeds it. A new theme dropped into
 * that directory is covered the moment it is added.
 */
function bundledThemes(): { id: string; vars: ThemeVars }[] {
  return readdirSync(THEMES_DIR)
    .filter((name) => name.endsWith(".css"))
    .map((name) => {
      const source = readFileSync(`${THEMES_DIR}/${name}`, "utf8");
      const id = /\[data-theme="([^"]+)"\]/.exec(source)?.[1] ?? name.replace(/\.css$/, "");
      const vars = Object.fromEntries(
        Object.entries(THEME_VARIABLES).map(([key, property]) => [
          key,
          new RegExp(`${property}:\\s*([^;]+);`).exec(source)?.[1].trim() ?? "",
        ]),
      ) as ThemeVars;
      return { id, vars };
    })
    .filter(({ vars }) => vars.bg !== "");
}

const THEMES = bundledThemes();

/** Every colour-ish token, as opposed to the gradients and the shadow. */
const COLOUR_KEYS = [
  "bg0",
  "panel",
  "card",
  "card2",
  "line",
  "line2",
  "text",
  "muted",
  "dim",
  "hover",
  "wash",
  "washLine",
  "accent",
  "onAccent",
  "accentSoft",
  "accentLine",
  "ok",
  "bad",
  "warn",
] as const satisfies readonly (keyof NebulaTokens)[];

function ratio(one: string, other: string): number {
  const first = parseHex(one);
  const second = parseHex(other);
  if (!first || !second) throw new Error(`not a hex pair: ${one} / ${other}`);
  return contrast(first, second);
}

describe("bundled themes", () => {
  it("finds the stylesheets", () => {
    expect(THEMES.length).toBeGreaterThanOrEqual(11);
    expect(THEMES.map((theme) => theme.id)).toContain("rose");
  });

  for (const { id, vars } of THEMES) {
    describe(id, () => {
      const mode = resolveMode(vars.bg);
      const tokens = deriveNebulaTokens(mode, vars);

      it("resolves every token to something CSS can take", () => {
        for (const [key, value] of Object.entries(tokens)) {
          expect(value, key).toBeTruthy();
          expect(value, key).not.toMatch(/var\(|undefined|NaN/);
        }
        for (const key of COLOUR_KEYS) {
          expect(tokens[key], key).toMatch(/^(#[0-9a-f]{6}|rgba?\()/i);
        }
      });

      it("keeps text readable on the window it lands on", () => {
        // The floors the derivation promises. They are checked against the
        // *derived* window colour rather than the theme's, because livery and
        // the mock fallbacks can both move it.
        expect(ratio(tokens.text, tokens.bg0)).toBeGreaterThanOrEqual(4.5);
        expect(ratio(tokens.muted, tokens.bg0)).toBeGreaterThanOrEqual(3);
        expect(ratio(tokens.dim, tokens.bg0)).toBeGreaterThanOrEqual(2.2);
      });

      it("keeps the accent and the status colours above the component floor", () => {
        for (const key of ["accent", "ok", "bad", "warn"] as const) {
          expect(ratio(tokens[key], tokens.bg0), key).toBeGreaterThanOrEqual(3);
        }
      });

      it("puts legible ink on a filled accent", () => {
        // Mobel's accent is a pale yellow and Ply's a mid blue; one wants dark
        // ink and the other light, and neither theme's own `--color-text-on-
        // accent` survives the contrast clamp that moved the accent.
        expect(ratio(tokens.onAccent, tokens.accent)).toBeGreaterThanOrEqual(3);
      });

      it("keeps the chrome translucent so the backdrop shows through", () => {
        expect(tokens.panel).toMatch(/^rgba\(/);
        expect(tokens.card2).toMatch(/^rgba\(/);
        expect(tokens.line).toMatch(/^rgba\(/);
      });

      it("gives the conversation a layered backdrop distinct from the surface tint", () => {
        expect(tokens.backdrop).not.toBe(tokens.tint);
        expect(tokens.backdrop.match(/gradient\(/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
        expect(tokens.tint.match(/gradient\(/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
      });

      it("carries the theme's own colours rather than the mock's", () => {
        if (NATIVE_THEME_IDS.has(id)) return;
        // The whole point: a theme has to actually move the paint. Comparing
        // against the mock for this mode is what "only switches light and dark"
        // would have failed.
        expect(tokens.bg0).not.toBe(NEBULA_TOKENS[mode].bg0);
        expect(tokens.accent).not.toBe(NEBULA_TOKENS[mode].accent);
      });
    });
  }
});

describe("nebulaTokensForTheme", () => {
  const rose = THEMES.find((theme) => theme.id === "rose")!;

  it("leaves the neutral themes to the mock", () => {
    // Dark and Light are the app's defaults, and Nebula's mock is its answer to
    // them. Deriving those two would repaint the pack for everyone who never
    // picked a theme at all.
    expect(nebulaTokensForTheme("dark", "dark", rose.vars)).toBe(NEBULA_TOKENS.dark);
    expect(nebulaTokensForTheme("light", "light", rose.vars)).toBe(NEBULA_TOKENS.light);
  });

  it("derives everything else", () => {
    const tokens = nebulaTokensForTheme("rose", "dark", rose.vars);
    expect(tokens.bg0).toBe("#1a0f14");
    expect(tokens.accent).toBe("#f472b6");
    // Rose tints its glass pink; Nebula's own alpha ladder is what it is worn at.
    expect(tokens.card2).toBe("rgba(255, 200, 220, 0.17)");
  });

  it("falls back to the mock before a stylesheet applies", () => {
    expect(nebulaTokensForTheme("rose", "dark", null)).toBe(NEBULA_TOKENS.dark);
    expect(nebulaTokensForTheme(null, "light", rose.vars)).toBe(NEBULA_TOKENS.light);
  });
});

describe("deriveNebulaTokens", () => {
  const empty = Object.fromEntries(Object.keys(THEME_VARIABLES).map((key) => [key, ""])) as ThemeVars;

  it("keeps the mock's value for every property a theme omits", () => {
    // The rule livery already follows: an absent field costs that one colour
    // and nothing else, which is why neither needs a "themed?" switch.
    const tokens = deriveNebulaTokens("dark", { ...empty, bg: "#1a0f14" });
    expect(tokens.bg0).toBe("#1a0f14");
    expect(tokens.accent).toBe(NEBULA_TOKENS.dark.accent);
    expect(tokens.text).toBe(NEBULA_TOKENS.dark.text);
  });

  it("raises a colour the theme left unreadable on its own window", () => {
    // Mobel's warning yellow on Mobel's near-white window is 1.4:1. A pill
    // painted with it is a pill nobody can see.
    const derived = deriveNebulaTokens("light", { ...empty, bg: "#f2f2f2", warning: "#f2cb57" });
    expect(derived.warn).not.toBe("#f2cb57");
    expect(ratio(derived.warn, "#f2f2f2")).toBeGreaterThanOrEqual(3);
  });
});
