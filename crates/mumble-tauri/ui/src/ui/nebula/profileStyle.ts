/**
 * How a profile card paints itself.
 *
 * The resolver moved into the shared profile-card package when the standalone
 * channel viewer started painting the same cards; Nebula keeps this import
 * path, and `nebulaCardTokens` below is the one Nebula-shaped thing left:
 * lending the card the window's own colour ramp so an unstyled card looks like
 * part of the app it is floating in.
 */
import { over, type ProfileCardTokens } from "@shared/profilecard";
import type { NebulaTokens } from "./tokens";

export { resolveProfilePaint } from "@shared/profilecard";
export type { ProfileInk, ProfilePaint, ProfileSticker } from "@shared/profilecard";

/** Nebula's palette in the ten slots the card asks a host for. */
export function nebulaCardTokens(nebula: NebulaTokens): ProfileCardTokens {
  return {
    bg0: nebula.bg0,
    // Nebula's `card` is a wash of light meant to sit on the window, and the
    // profile card is the one card that does not: it floats over the roster,
    // the conversation, a banner photograph. Mixed down onto `bg0` it keeps the
    // shade the mock draws without turning into a pane of glass over whatever
    // it covers.
    surface: over(nebula.card, nebula.bg0),
    fill: nebula.card2,
    line: nebula.line2,
    text: nebula.text,
    muted: nebula.muted,
    dim: nebula.dim,
    accent: nebula.accent,
    ok: nebula.ok,
    bad: nebula.bad,
    warn: nebula.warn,
    shadow: nebula.shadow,
  };
}
