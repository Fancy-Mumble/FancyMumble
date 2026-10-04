import { describe, expect, it } from "vitest";
import { THEMES } from "./index";

// Stylesheets as text, keyed by path (a glob rather than `node:fs`, as in the
// Nebula theme tests, so it also runs under the browser-like environment).
const SOURCES = import.meta.glob<string>("./*.css", { query: "?raw", import: "default", eager: true });

describe("--color-text-rgb", () => {
  // Hardcoded text colours are written `rgba(var(--color-text-rgb), x)` so they
  // follow the theme. A theme without the token would drop those colours.
  for (const { id } of THEMES) {
    it(`${id} defines it as an r, g, b triplet`, () => {
      const source = SOURCES[`./${id}.css`];
      expect(source, `${id}.css`).toBeTruthy();
      expect(source).toMatch(/--color-text-rgb:\s*\d{1,3},\s*\d{1,3},\s*\d{1,3};/);
    });
  }
});
