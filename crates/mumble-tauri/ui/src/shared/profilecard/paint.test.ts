import { describe, expect, it } from "vitest";
import { READABLE_LC, contrastLc, over } from "./color";
import { resolveProfilePaint } from "./paint";
import { userTint } from "./tint";
import { PROFILE_CARD_TOKENS } from "./tokens";

const TINT = userTint("myuser");
const TOKENS = PROFILE_CARD_TOKENS.dark;

/** The stops of a `linear-gradient(...)` string. */
function stopsOf(css: string): string[] {
  return css.match(/#[0-9a-f]{6}/gi) ?? [];
}

describe("resolveProfilePaint readability", () => {
  it("keeps the plain card on the host's ramp and accent", () => {
    const paint = resolveProfilePaint(null, TINT, TOKENS);
    expect(paint.card).toBeNull();
    expect(paint.ink.text).toBe(TOKENS.text);
    expect(paint.ink.muted).toBe(TOKENS.muted);
    expect(paint.ink.accent).toBe(TOKENS.accent);
  });

  it("writes readably on the bright green that raised this", () => {
    const paint = resolveProfilePaint(
      { themeColors: ["#0f9d58", "#2ecc71", "#7bed9f", "#2dd4bf", "#38bdf8"] },
      TINT,
      TOKENS,
    );
    const stops = stopsOf(String(paint.card?.background));
    expect(stops).toHaveLength(3);
    for (const stop of stops) {
      expect(contrastLc(stop, paint.ink.text)).toBeGreaterThanOrEqual(READABLE_LC.text);
      expect(contrastLc(stop, over(paint.ink.muted, stop))).toBeGreaterThanOrEqual(READABLE_LC.muted);
      expect(contrastLc(stop, over(paint.ink.dim, stop))).toBeGreaterThanOrEqual(READABLE_LC.dim);
      expect(contrastLc(stop, paint.ink.accent)).toBeGreaterThanOrEqual(READABLE_LC.accent);
      expect(contrastLc(stop, paint.ink.readable("#2dd4bf"))).toBeGreaterThanOrEqual(READABLE_LC.accent);
    }
  });

  it("holds a hand-written background to the same bar", () => {
    const paint = resolveProfilePaint(
      {
        cardBackground: "custom",
        cardBackgroundCustom: "linear-gradient(180deg, #ffffff, #000000)",
      },
      TINT,
      TOKENS,
    );
    const css = String(paint.card?.background);
    expect(css).toMatch(/^linear-gradient\(180deg, #[0-9a-f]{6}, #[0-9a-f]{6}\)$/);
    for (const stop of stopsOf(css)) {
      expect(contrastLc(stop, paint.ink.text)).toBeGreaterThanOrEqual(READABLE_LC.text);
    }
    expect(paint.ground).toBe(stopsOf(css)[0]);
  });

  it("leaves a background it cannot read to the host's ink", () => {
    const paint = resolveProfilePaint(
      { cardBackground: "custom", cardBackgroundCustom: "url(x.png)" },
      TINT,
      TOKENS,
    );
    expect(paint.card).toEqual({ background: "url(x.png)" });
    expect(paint.ink.text).toBe(TOKENS.text);
  });

  it("writes the name dark on a pale nameplate and light on a dark one", () => {
    expect(resolveProfilePaint({ nameplate: "silver" }, TINT, TOKENS).name.color).toBe("#111111");
    expect(resolveProfilePaint({ nameplate: "dark" }, TINT, TOKENS).name.color).toBe("#ffffff");
  });

  it("holds a chosen name colour to the surface it sits on", () => {
    const onPlate = resolveProfilePaint({ nameplate: "gold", nameStyle: { color: "#fbbf24" } }, TINT, TOKENS);
    expect(contrastLc("#fbbf24", String(onPlate.name.color))).toBeGreaterThanOrEqual(READABLE_LC.text);
    const onCard = resolveProfilePaint(
      { themeColors: ["#1e2b47"], nameStyle: { color: "#1a2340" } },
      TINT,
      TOKENS,
    );
    expect(contrastLc("#1e2b47", String(onCard.name.color))).toBeGreaterThanOrEqual(READABLE_LC.text);
  });

  it("deepens the banner chrome until white reads on a pale banner", () => {
    const pale = resolveProfilePaint({ banner: { color: "#ffffff" } }, TINT, TOKENS);
    const deep = resolveProfilePaint({ banner: { color: "#1e2b47" } }, TINT, TOKENS);
    expect(deep.bannerChrome).toBe("rgba(0,0,0,0.28)");
    expect(pale.bannerChrome).not.toBe(deep.bannerChrome);
    const alpha = Number(/,([\d.]+)\)$/.exec(pale.bannerChrome)?.[1]);
    expect(contrastLc(over(`rgba(0,0,0,${alpha})`, "#ffffff"), "#ffffff")).toBeGreaterThanOrEqual(
      READABLE_LC.text,
    );
  });

  it("writes the send glyph in whichever ink reads on the accent", () => {
    const pale = ["#111", "#222", "#333", "#444", "#f5f5f5"];
    const deep = ["#111", "#222", "#333", "#444", "#1d4ed8"];
    expect(resolveProfilePaint({ themeColors: pale }, TINT, TOKENS).send.color).toBe("#111111");
    expect(resolveProfilePaint({ themeColors: deep }, TINT, TOKENS).send.color).toBe("#ffffff");
  });
});
