/**
 * The colour ramp a host lends the card.
 *
 * A card with no `FancyProfile` behind it takes the surrounding window's
 * colours rather than shipping a palette of its own - that is what keeps an
 * unstyled card looking like part of the app it is floating in, in the client
 * and in the channel viewer alike. Hosts map their own theme onto these ten
 * slots; the two ramps below are the fallback for a host that has none.
 */
export interface ProfileCardTokens {
  /** The window surface behind the card, and the shade its own is mixed from. */
  bg0: string;
  /**
   * The card's own fill, used when the profile picks no colours.
   *
   * Opaque, and flat rather than a gradient: the card floats over a message
   * list, a photograph, another panel, so a translucent fill would take on
   * whatever it happened to be covering instead of the shade the host meant -
   * see `over` in `color.ts`. The avatar punches out of it, so it is also drawn
   * as a ring.
   */
  surface: string;
  /** A raised block inside the card: the activity row, the composer pill. */
  fill: string;
  /** Hairline around the card and between its blocks. */
  line: string;
  text: string;
  muted: string;
  dim: string;
  accent: string;
  ok: string;
  bad: string;
  warn: string;
  shadow: string;
}

export const PROFILE_CARD_TOKENS: Record<"light" | "dark", ProfileCardTokens> = {
  dark: {
    bg0: "#141d33",
    surface: "#1e2b47",
    fill: "rgba(130,178,255,.13)",
    line: "rgba(135,180,255,.17)",
    text: "#f1f5ff",
    muted: "#9fb3dd",
    dim: "#65779f",
    accent: "#41b4f9",
    ok: "#3cd88e",
    bad: "#f57e7e",
    warn: "#ecba55",
    shadow: "0 30px 80px rgba(2,6,18,.6)",
  },
  light: {
    bg0: "#fdfbf6",
    surface: "#ffffff",
    fill: "rgba(40,48,80,.06)",
    line: "rgba(40,48,80,.12)",
    text: "#252a3c",
    muted: "#666e85",
    dim: "#98a0b4",
    accent: "#1691dc",
    ok: "#1ba572",
    bad: "#d05e5e",
    warn: "#aa8138",
    shadow: "0 30px 60px rgba(50,55,85,.18)",
  },
};
