import { describe, expect, it } from "vitest";
import {
  READABLE_LC,
  colorsIn,
  contrastLc,
  inkForStops,
  mapColorsIn,
  over,
  readableAlpha,
  readableOn,
  readableStops,
  resolveThemePalette,
  scrimAlpha,
} from "./color";
import { PROFILE_CARD_TOKENS } from "./tokens";

describe("over", () => {
  it("mixes a translucent wash down onto the colour under it", () => {
    // Nebula's raised surface: a 10% wash of blue over the window's own navy.
    expect(over("rgba(120,172,255,.10)", "#141d33")).toBe("#1e2b47");
    expect(over("rgba(255,255,255,.5)", "#000000")).toBe("#808080");
  });

  it("takes both syntaxes a theme's tokens arrive in", () => {
    expect(over("#ffffff80", "#000000")).toBe("#808080");
    expect(over("rgb(255 255 255 / 0.5)", "#000")).toBe("#808080");
  });

  it("passes an opaque colour straight through, whatever is under it", () => {
    expect(over("#41b4f9", "#141d33")).toBe("#41b4f9");
  });

  it("leaves a colour it cannot take apart alone rather than dropping it", () => {
    expect(over("var(--card)", "#141d33")).toBe("var(--card)");
    expect(over("#141d33", "linear-gradient(#000,#fff)")).toBe("#141d33");
  });
});

describe("PROFILE_CARD_TOKENS", () => {
  // The card floats over a message list, a photograph, another panel. A
  // translucent fill would take on whatever it happens to be covering - the
  // bug this guards is a card with the roster showing through one half of it.
  it.each(["light", "dark"] as const)("keeps the %s card's own surface opaque", (mode) => {
    expect(PROFILE_CARD_TOKENS[mode].surface).toMatch(/^#(?:[0-9a-f]{6}|[0-9a-f]{3})$/i);
  });

  // A styled card is held to these rungs; the host ramps are left as their
  // theme drew them, which only holds up if they clear the same bar.
  it.each(["light", "dark"] as const)("draws the %s ramp readably on its own surface", (mode) => {
    const tokens = PROFILE_CARD_TOKENS[mode];
    expect(contrastLc(tokens.surface, tokens.text)).toBeGreaterThanOrEqual(READABLE_LC.text);
    expect(contrastLc(tokens.surface, over(tokens.muted, tokens.surface))).toBeGreaterThanOrEqual(
      READABLE_LC.muted,
    );
  });
});

describe("inkForStops", () => {
  it("writes light on a dark or saturated card and dark on a pale one", () => {
    expect(inkForStops(["#1e2b47"]).ink).toBe("#ffffff");
    expect(inkForStops(["#ff0000"]).ink).toBe("#ffffff");
    expect(inkForStops(["#fdfbf6"]).ink).toBe("#111111");
  });

  it("reports how badly the better ink does on the worst stop", () => {
    expect(inkForStops(["#1e2b47"]).lc).toBeGreaterThan(READABLE_LC.text);
    // Nothing reads on both ends of a white-to-black rake.
    expect(inkForStops(["#ffffff", "#000000"]).lc).toBeLessThan(10);
  });
});

describe("readableStops", () => {
  it("leaves a palette the ink already reads on exactly as picked", () => {
    expect(readableStops(["#1e2b47", "#2a3a5e"], "#ffffff")).toEqual(["#1e2b47", "#2a3a5e"]);
  });

  it("deepens only the stop a light ink is lost on", () => {
    const stops = readableStops(["#14532d", "#22c55e"], "#ffffff");
    expect(stops[0]).toBe("#14532d");
    expect(stops[1]).not.toBe("#22c55e");
    for (const stop of stops) {
      expect(contrastLc(stop, "#ffffff")).toBeGreaterThanOrEqual(READABLE_LC.text);
    }
  });

  it("makes even white beside black readable in one ink", () => {
    const { ink } = inkForStops(["#ffffff", "#000000"]);
    for (const stop of readableStops(["#ffffff", "#000000"], ink)) {
      expect(contrastLc(stop, ink)).toBeGreaterThanOrEqual(READABLE_LC.text);
    }
  });

  it("keeps a translucent stop translucent", () => {
    expect(readableStops(["rgba(255,255,255,0.5)"], "#ffffff")[0]).toMatch(/, 0\.5\)$/);
  });
});

describe("readableOn", () => {
  it("returns a colour that already reads untouched", () => {
    expect(readableOn("#41b4f9", ["#1e2b47"], "#ffffff")).toBe("#41b4f9");
  });

  it("pulls a lost accent toward the ink until it reads, keeping its hue", () => {
    // A teal role on a bright green card - the screenshot that raised this.
    const teal = readableOn("#2dd4bf", ["#22c55e"], "#111111");
    expect(teal).not.toBe("#2dd4bf");
    expect(contrastLc("#22c55e", teal)).toBeGreaterThanOrEqual(READABLE_LC.accent);
    const [r, g, b] = [1, 3, 5].map((at) => parseInt(teal.slice(at, at + 2), 16));
    expect(g).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(r);
  });

  it("lifts a dark tone on a dark card rather than sinking it", () => {
    const navy = readableOn("#1a2340", ["#141d33"], "#ffffff");
    expect(contrastLc("#141d33", navy)).toBeGreaterThanOrEqual(READABLE_LC.accent);
  });

  it("stops at the ink on a surface that cannot give the target to anything", () => {
    // The silver nameplate: nothing reads at 60 on it, so a gold name is
    // deepened to what the ink itself gets there, not driven to black.
    const silver = ["#d1d5db", "#9ca3af"];
    const gold = readableOn("#fbbf24", silver, "#111111", READABLE_LC.text);
    expect(gold).not.toBe("#111111");
    expect(gold).not.toBe("#000000");
    const [r, , b] = [1, 3, 5].map((at) => parseInt(gold.slice(at, at + 2), 16));
    expect(r).toBeGreaterThan(b);
    const floor = inkForStops(silver).lc;
    for (const stop of silver) expect(contrastLc(stop, gold)).toBeGreaterThanOrEqual(floor - 6);
  });

  it("leaves a colour it cannot parse alone", () => {
    expect(readableOn("var(--x)", ["#141d33"], "#ffffff")).toBe("var(--x)");
  });
});

describe("readableAlpha", () => {
  it("keeps the floor where the ink has room to fade", () => {
    expect(readableAlpha("#ffffff", ["#1e2b47"], READABLE_LC.dim, 0.45)).toBe(0.45);
  });

  it("raises it on a surface with less headroom", () => {
    // A mid grey: white is the ink, but 45% of it is only a lighter grey.
    const alpha = readableAlpha("#ffffff", ["#808080"], READABLE_LC.dim, 0.45);
    expect(alpha).toBeGreaterThan(0.45);
    expect(contrastLc("#808080", over(`rgba(255,255,255,${alpha})`, "#808080"))).toBeGreaterThanOrEqual(
      READABLE_LC.dim,
    );
  });
});

describe("scrimAlpha", () => {
  it("keeps the floor over a banner white already reads on", () => {
    expect(scrimAlpha(["#3b5bdb"], READABLE_LC.text, 0.28)).toBe(0.28);
  });

  it("darkens over a white banner until white reads", () => {
    const alpha = scrimAlpha(["#ffffff"], READABLE_LC.text, 0.28);
    expect(alpha).toBeGreaterThan(0.28);
    expect(contrastLc(over(`rgba(0,0,0,${alpha})`, "#ffffff"), "#ffffff")).toBeGreaterThanOrEqual(
      READABLE_LC.text,
    );
  });
});

describe("colorsIn", () => {
  it("picks the stops out of a hand-written gradient, in order", () => {
    expect(colorsIn("linear-gradient(135deg, #fff 0%, rgba(0, 0, 0, .5) 50%, #123456)")).toEqual([
      "#fff",
      "rgba(0, 0, 0, .5)",
      "#123456",
    ]);
  });

  it("finds nothing in a value with no colour it can read", () => {
    expect(colorsIn("url(x.png) center/cover")).toEqual([]);
    expect(colorsIn("rebeccapurple")).toEqual([]);
  });

  it("puts swapped colours back exactly where they were", () => {
    expect(mapColorsIn("linear-gradient(#fff, #000)", (_c, i) => `#${i}${i}${i}`)).toBe(
      "linear-gradient(#000, #111)",
    );
  });
});

describe("resolveThemePalette", () => {
  it("builds the gradient from stops its text colour reads on", () => {
    const palette = resolveThemePalette(["#ffffff", "#000000"]);
    for (const stop of palette.stops) {
      expect(contrastLc(stop, palette.textColor)).toBeGreaterThanOrEqual(READABLE_LC.text);
      expect(palette.gradient).toContain(stop);
    }
  });

  it("paints a palette that was fine exactly as picked", () => {
    const palette = resolveThemePalette(["#1e2b47", "#2a3a5e", "#3b4f80"]);
    expect(palette.stops).toEqual(["#1e2b47", "#2a3a5e", "#3b4f80"]);
    expect(palette.gradient).toBe("linear-gradient(135deg, #1e2b47, #2a3a5e, #3b4f80)");
  });
});
