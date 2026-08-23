import { describe, expect, it } from "vitest";
import { over } from "./color";
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
});
