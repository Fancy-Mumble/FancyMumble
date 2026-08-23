import { describe, expect, it } from "vitest";
import {
  CONTRAST_ACCENT,
  clamp,
  contrast,
  liveryTokens,
  parseHex,
  type ServerLivery,
} from "./livery";
import { NEBULA_TOKENS } from "./tokens";

const DARK = NEBULA_TOKENS.dark;
const LIGHT = NEBULA_TOKENS.light;

function livery(palette: ServerLivery["palette"]): ServerLivery {
  return { version: 1, tags: [], palette };
}

describe("parseHex", () => {
  it("takes six hex digits and nothing else", () => {
    expect(parseHex("#8a90ff")).toEqual([0x8a, 0x90, 0xff]);
    expect(parseHex("#8A90FF")).toEqual([0x8a, 0x90, 0xff]);
  });

  it("refuses anything that could carry a second declaration", () => {
    // The safety property is that no server string survives as CSS. Each of
    // these is dropped rather than repaired.
    for (const bad of [
      "8a90ff",
      "#fff",
      "#8a90f",
      "#zzzzzz",
      "red",
      "red;background:url(http://x)",
      "var(--accent)",
      "",
      undefined,
    ]) {
      expect(parseHex(bad)).toBeNull();
    }
  });
});

describe("clamp", () => {
  it("leaves a colour that already reads alone", () => {
    const accent = parseHex("#41b4f9")!;
    const surface = parseHex(DARK.bg0)!;
    expect(clamp(accent, surface)).toEqual(accent);
  });

  it("will not let a server hide its own button on a dark surface", () => {
    const surface = parseHex(DARK.bg0)!;
    const result = clamp(parseHex("#0b0f1a")!, surface);
    expect(contrast(result, surface)).toBeGreaterThanOrEqual(CONTRAST_ACCENT);
  });

  it("holds on a light surface too", () => {
    // A single-mode clamp would let the same accent read on one theme and
    // vanish on the other, which is the failure a per-mode palette exists to
    // prevent.
    const surface = parseHex(LIGHT.bg0)!;
    for (const accent of ["#fffef8", "#f5f3ee", "#ffffff"]) {
      const result = clamp(parseHex(accent)!, surface);
      expect(contrast(result, surface)).toBeGreaterThanOrEqual(CONTRAST_ACCENT);
    }
  });

  it("keeps the hue it was given", () => {
    // Legible, and still recognisably the colour the operator chose rather than
    // a substitute.
    const surface = parseHex(DARK.bg0)!;
    const [red, green, blue] = clamp(parseHex("#0d0033")!, surface);
    expect(blue).toBeGreaterThan(red);
    expect(blue).toBeGreaterThan(green);
  });

  it("agrees with the server's preview at the extremes", () => {
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 1);
    expect(contrast([0, 0, 0], [0, 0, 0])).toBeCloseTo(1, 1);
  });
});

describe("liveryTokens", () => {
  it("returns the pack's tokens untouched when no livery arrived", () => {
    expect(liveryTokens(DARK, null, "dark")).toBe(DARK);
  });

  it("returns them untouched for a server that sent artwork but no colours", () => {
    // The mock's middle rung, and the one most servers sit on: it has to need
    // no code of its own.
    const bannerOnly = livery({});
    bannerOnly.bannerSrc = "blob:banner";
    expect(liveryTokens(DARK, bannerOnly, "dark")).toBe(DARK);
  });

  it("applies only the mode the operator filled in", () => {
    const darkOnly = livery({ dark: { accent: "#8a90ff" } });
    expect(liveryTokens(DARK, darkOnly, "dark").accent).toBe("#8a90ff");
    expect(liveryTokens(LIGHT, darkOnly, "light")).toBe(LIGHT);
  });

  it("keeps the pack's value for every colour the server did not name", () => {
    const partial = livery({ dark: { accent: "#8a90ff" } });
    const result = liveryTokens(DARK, partial, "dark");
    expect(result.bg0).toBe(DARK.bg0);
    expect(result.text).toBe(DARK.text);
    expect(result.tint).toBe(DARK.tint);
  });

  it("derives the soft and line accents from the clamped colour", () => {
    // Otherwise the variants reintroduce exactly the colour the floor rejected.
    const hidden = livery({ dark: { accent: "#0b0f1a" } });
    const result = liveryTokens(DARK, hidden, "dark");
    expect(result.accent).not.toBe("#0b0f1a");
    expect(result.accentSoft).not.toContain("11,15,26");
  });

  it("drops a colour that is not #rrggbb rather than passing it through", () => {
    const hostile = livery({ dark: { accent: "red;background:url(http://x)" } });
    const result = liveryTokens(DARK, hostile, "dark");
    expect(result.accent).toBe(DARK.accent);
    expect(result.accent).not.toContain("url");
  });

  it("builds the aura itself rather than taking a gradient from the server", () => {
    const aura = livery({ dark: { auraFrom: "#7d82ff", auraTo: "#41b4f9" } });
    const result = liveryTokens(DARK, aura, "dark");
    expect(result.tint).toContain("rgba(125,130,255,0.22)");
    expect(result.tint).toContain("radial-gradient");
  });

  it("judges the accent against the operator's own surface", () => {
    // A server that darkens the ground and keeps a mid accent must be measured
    // against the ground it actually set, not the pack's.
    const both = livery({ dark: { surface: "#000000", accent: "#0a0a0a" } });
    const result = liveryTokens(DARK, both, "dark");
    expect(result.bg0).toBe("#000000");
    expect(contrast(parseHex(result.accent)!, [0, 0, 0])).toBeGreaterThanOrEqual(CONTRAST_ACCENT);
  });
});
