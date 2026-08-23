import { describe, expect, it } from "vitest";
import type { FancyProfile } from "@core/types";
import { userTint } from "./selectors";
import { nebulaCardTokens, resolveProfilePaint } from "./profileStyle";
import { NEBULA_TOKENS } from "./tokens";

const DARK = nebulaCardTokens(NEBULA_TOKENS.dark);
const TINT = userTint("zewiwin");

function paint(profile: FancyProfile | null) {
  return resolveProfilePaint(profile, TINT, DARK);
}

describe("nebulaCardTokens", () => {
  // Nebula's `card` is a wash of light meant to sit on the window; the profile
  // card is the one card that floats over the roster and the conversation
  // instead, so handed that wash directly it turns into glass and the panel
  // behind it shows through one half of the card.
  it.each(["light", "dark"] as const)("hands the %s card an opaque surface", (mode) => {
    expect(nebulaCardTokens(NEBULA_TOKENS[mode]).surface).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("mixes that surface down to the shade the mock draws on the window", () => {
    expect(nebulaCardTokens(NEBULA_TOKENS.dark).surface).toBe("#1e2b47");
    expect(nebulaCardTokens(NEBULA_TOKENS.light).surface).toBe("#ffffff");
  });
});

describe("resolveProfilePaint", () => {
  it("leaves a user who has set nothing on the window's own colours", () => {
    const plain = paint(null);
    expect(plain.card).toBeNull();
    expect(plain.ground).toBe(DARK.surface);
    expect(plain.ink.text).toBe(DARK.text);
    expect(plain.ink.accent).toBe(DARK.accent);
    expect(plain.send.background).toBe(DARK.accent);
  });

  it("rakes the assigned colour across the banner and fills the avatar with it", () => {
    const { banner, avatarFill } = paint(null);
    expect(banner.background).toBe(
      `linear-gradient(150deg,${TINT.from} 0%,${TINT.mid} 55%,${TINT.to} 100%)`,
    );
    expect(avatarFill).toBe(TINT.mid);
  });

  it("repaints the card from the user's theme colours, glow included", () => {
    const styled = paint({ themeColors: ["#2b2420", "#211c24", "#271d1d", "#e8b84b"] });
    expect(styled.card?.background).toContain("165deg");
    // The border colour is the first extra past the three gradient stops, and
    // the card's glow is that same colour held further back.
    expect(styled.card?.borderColor).toBe("rgba(232, 184, 75, 0.45)");
    expect(styled.card?.boxShadow).toContain("rgba(232, 184, 75, 0.12)");
  });

  it("writes a styled card in a ramp struck off its own text colour", () => {
    const styled = paint({ themeColors: ["#2b2420", "#211c24", "#271d1d"] });
    expect(styled.ink.text).toBe("#ffffff");
    expect(styled.ink.muted).toBe("rgba(255, 255, 255, 0.62)");
    expect(styled.ink.dim).toBe("rgba(255, 255, 255, 0.45)");
  });

  it("fades a photographed banner into the card instead of glossing it", () => {
    const withImage = paint({ banner: { image: "data:image/png;base64,AA" }, themeColors: ["#2b2420", "#211c24"] });
    expect(withImage.banner.backgroundImage).toBe("url(data:image/png;base64,AA)");
    expect(withImage.bannerScrim.background).toContain("transparent 45%");
    expect(withImage.bannerChrome).toBe("rgba(0,0,0,.35)");
    expect(paint(null).bannerScrim.background).toContain("radial-gradient");
  });

  it("rings a styled avatar in the card's accent pair, and an explicit preset over that", () => {
    const derived = paint({ themeColors: ["#2b2420", "#e8b84b", "#f0623d", "#e8b84b", "#f0623d"] });
    expect(derived.avatarRing.background).toBe("linear-gradient(135deg,#e8b84b,#f0623d)");
    expect(derived.avatarRing.padding).toBe("3px");

    const chosen = paint({ themeColors: ["#2b2420"], avatarBorder: "neon_blue" });
    expect(chosen.avatarRing.border).toBe("2px solid #00d4ff");
    expect(chosen.avatarRing.background).toBeUndefined();

    // An unstyled avatar is ringed in the card it is punched out of, not in
    // the window behind it - the card floats, so the window is not there.
    expect(paint(null).avatarRing.border).toBe(`4px solid ${DARK.surface}`);
  });

  it("takes the nameplate and font the user picked, and paints a gradient name into the text", () => {
    const styled = paint({
      nameplate: "gradient_purple",
      nameStyle: { font: "cursive", gradient: ["#5b6cd9", "#8a5cf0"], glow: { color: "#8a5cf0", size: 8 } },
    });
    expect(styled.nameplate).toBe("linear-gradient(135deg,#a855f7,#6366f1)");
    expect(styled.name.fontFamily).toBe("'Segoe Script', cursive");
    expect(styled.name.WebkitTextFillColor).toBe("transparent");
    expect(styled.name.textShadow).toBe("0 0 8px #8a5cf0");
  });

  it("treats the 'none' presets as nothing chosen", () => {
    const none = paint({ nameplate: "none", decoration: "none", avatarBorder: "none" });
    expect(none.nameplate).toBeNull();
    expect(none.decoration).toBeNull();
    expect(none.card).toBeNull();
  });

  it("hands the sticker back for a card that has to make room for it", () => {
    expect(paint({ decoration: "gold" }).decoration).toEqual({ kind: "text", text: "👑" });
  });

  it("prefers the user's own sticker art over the catalogue emoji", () => {
    const own = paint({ decoration: "custom", decorationImage: "data:image/png;base64,AA" });
    expect(own.decoration).toEqual({ kind: "image", src: "data:image/png;base64,AA" });
  });
});
