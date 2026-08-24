/**
 * How a profile card paints itself.
 *
 * The mock draws two profile cards, and they are not two components: they are
 * the same card with and without a `FancyProfile` behind it. Unstyled, it takes
 * the host window's colours and the banner the user's name is hashed into;
 * styled, every surface on it - card, banner, avatar ring, nameplate, sticker,
 * send button, and the whole text ramp - comes off the profile instead.
 * Resolving that here keeps the card itself one tree with one set of slots, and
 * makes the mapping from a stored profile to pixels testable without mounting
 * anything.
 */
import type { CSSProperties } from "react";
import { AVATAR_BORDERS, DECORATIONS, FONTS, NAMEPLATES } from "./catalog";
import {
  READABLE_LC,
  buildGradient,
  colorsIn,
  inkForStops,
  mapColorsIn,
  readableAlpha,
  readableOn,
  readableStops,
  resolveThemePalette,
  scrimAlpha,
  textColorForBg,
  textColorForGradient,
  withAlpha,
} from "./color";
import type { FancyProfile } from "./profileTypes";
import type { UserTint } from "./tint";
import type { ProfileCardTokens } from "./tokens";

/** The text ramp the card writes in - host tokens, or the card's own palette. */
export interface ProfileInk {
  text: string;
  muted: string;
  dim: string;
  /** Raised block inside the card: the activity row, the composer pill. */
  fill: string;
  line: string;
  accent: string;
  /**
   * A colour that arrived with the content - a role, a badge tone - pulled
   * just far enough toward the ink that it reads on this card. Every colour
   * the card did not choose itself goes through here before it is drawn.
   */
  readable: (color: string) => string;
}

/** The sticker overhanging the card's corner: an emoji, or the user's own art. */
export type ProfileSticker = { kind: "text"; text: string } | { kind: "image"; src: string };

export interface ProfilePaint {
  /** Overrides for the floating surface, or null to keep the host's own. */
  card: CSSProperties | null;
  /**
   * The flat colour the card's own surface reads as.
   *
   * Anything that punches a hole in the card - the avatar's ring, the ring
   * around its presence pip, the foot of a banner photograph - is drawn in
   * this, so it disappears into the card rather than outlining a shape on it.
   */
  ground: string;
  banner: CSSProperties;
  /** Laid over the banner: a gloss on a flat one, a fade under an image. */
  bannerScrim: CSSProperties;
  /** Scrim behind the banner's own controls, darker over a photograph. */
  bannerChrome: string;
  avatarRing: CSSProperties;
  avatarFill: string;
  avatarInk: string;
  /** Pill behind the name, or null for a bare name. */
  nameplate: string | null;
  name: CSSProperties;
  decoration: ProfileSticker | null;
  ink: ProfileInk;
  send: { background: string; color: string };
}

/**
 * The flat colours a card's surface is made of, and the ink that reads on
 * every one of them.
 *
 * Whatever paints the card - the host's theme, the profile's gradient, a
 * hand-written CSS background - is reduced to this before any text is put on
 * it, so the ramp, the accents and the tones are all held to the same colours
 * the text actually sits over.
 */
interface Surface {
  stops: string[];
  ink: string;
}

function preset<T extends { id: string }>(table: readonly T[], id: string | undefined): T | undefined {
  return id && id !== "none" ? table.find((entry) => entry.id === id) : undefined;
}

/**
 * A hand-written card background, made readable.
 *
 * The CSS is anything the owner typed; the colours in it are picked out,
 * pushed the least distance that lets one ink read on all of them, and put
 * back where they were. A value with no colour in it - a `url()`, a named
 * colour - is left alone and the host's ink is trusted over it.
 */
function readableCss(css: string): (Surface & { css: string }) | null {
  const raw = colorsIn(css);
  if (raw.length === 0) return null;
  const { ink } = inkForStops(raw);
  const stops = readableStops(raw, ink);
  return { css: mapColorsIn(css, (_color, index) => stops[index]), stops, ink };
}

export function resolveProfilePaint(
  profile: FancyProfile | null,
  tint: UserTint,
  tokens: ProfileCardTokens,
): ProfilePaint {
  const nameStyle = profile?.nameStyle ?? {};
  const nameplate = preset(NAMEPLATES, profile?.nameplate)?.bg ?? null;
  const colors = profile?.themeColors ?? [];
  const glass = profile?.cardGlass ?? false;
  const palette = colors.length > 0 ? resolveThemePalette(colors, glass) : null;
  const customCss =
    profile?.cardBackground === "custom" && profile.cardBackgroundCustom
      ? profile.cardBackgroundCustom
      : null;
  const custom = customCss ? readableCss(customCss) : null;
  const surface: Surface =
    custom ??
    (palette
      ? { stops: palette.stops, ink: palette.textColor }
      : { stops: [tokens.surface], ink: tokens.text });
  const readable = (color: string) => readableOn(color, surface.stops, surface.ink);
  const accent = palette?.accentColor ?? palette?.borderColor ?? null;

  // A custom sticker is an image the user uploaded; the catalogue entries are
  // emoji. Both hang off the same corner, so the card is told which it has
  // rather than being handed a string it would have to guess about.
  let decoration: ProfileSticker | null = null;
  if (profile?.decoration === "custom" && profile.decorationImage) {
    decoration = { kind: "image", src: profile.decorationImage };
  } else {
    const preview = preset(DECORATIONS, profile?.decoration)?.preview;
    if (preview && preview !== "-") decoration = { kind: "text", text: preview };
  }

  // The card's own palette fades its ink for the quieter rungs of the ramp,
  // and only as far as the surface allows: a saturated mid-tone leaves less
  // headroom than a navy, so its captions stay closer to full strength.
  const ink: ProfileInk =
    custom || palette
      ? {
          text: surface.ink,
          muted: withAlpha(surface.ink, readableAlpha(surface.ink, surface.stops, READABLE_LC.muted, 0.62)),
          dim: withAlpha(surface.ink, readableAlpha(surface.ink, surface.stops, READABLE_LC.dim, 0.45)),
          fill: withAlpha(surface.ink, 0.07),
          line: withAlpha(surface.ink, 0.14),
          accent: accent ? readable(accent) : surface.ink,
          readable,
        }
      : {
          text: tokens.text,
          muted: tokens.muted,
          dim: tokens.dim,
          fill: tokens.fill,
          line: tokens.line,
          accent: readable(tokens.accent),
          readable,
        };

  let card: CSSProperties | null = null;
  if (customCss) {
    card = { background: custom?.css ?? customCss };
  } else if (palette) {
    card = {
      // Raked steeper than the 135deg the settings preview uses: on a card this
      // tall the stops have to read as bands down it, not across one corner.
      background: buildGradient(palette.stops, 165, glass ? 0.55 : 1),
      borderColor: withAlpha(palette.borderColor, 0.45),
      boxShadow: `${tokens.shadow},0 0 30px ${withAlpha(palette.borderColor, 0.12)}`,
      ...(glass ? { backdropFilter: "blur(16px) saturate(1.4)" } : {}),
    };
  }

  const image = profile?.banner?.image;
  const bannerStops = profile?.banner?.color
    ? colorsIn(profile.banner.color)
    : [tint.from, tint.mid, tint.to];
  const banner: CSSProperties = image
    ? { backgroundImage: `url(${image})`, backgroundSize: "cover", backgroundPosition: "center" }
    : {
        background:
          profile?.banner?.color ?? `linear-gradient(150deg,${tint.from} 0%,${tint.mid} 55%,${tint.to} 100%)`,
      };

  // A photograph runs under the name, so it fades into the card it sits on
  // rather than carrying the gloss a flat banner gets.
  let ground = tokens.surface;
  if (custom) ground = custom.stops[0];
  else if (palette) ground = palette.stops[colors.length > 1 ? 1 : 0] ?? tokens.surface;
  const bannerScrim: CSSProperties = image
    ? { background: `linear-gradient(180deg,transparent 45%,${withAlpha(ground, 0.9)})` }
    : {
        background: "radial-gradient(240px 140px at 80% 0%,rgba(255,255,255,.28),transparent 60%)",
      };

  const border = AVATAR_BORDERS.find((entry) => entry.id === profile?.avatarBorder);
  let avatarRing: CSSProperties;
  if (profile?.avatarBorder === "custom" && profile.avatarBorderCustom) {
    avatarRing = { border: profile.avatarBorderCustom };
  } else if (border && border.id !== "default" && border.id !== "custom") {
    avatarRing = {
      border: border.border,
      ...(border.shadow ? { boxShadow: border.shadow } : {}),
      ...(border.outline ? { outline: border.outline } : {}),
    };
  } else if (accent && palette) {
    // The mock rings a styled avatar in the card's own accent pair - a 3px pad
    // of gradient the portrait sits inside - not in the window colour.
    avatarRing = {
      padding: "3px",
      background: `linear-gradient(135deg,${palette.borderColor},${accent})`,
    };
  } else {
    avatarRing = { border: `4px solid ${ground}` };
  }

  // The name sits on its nameplate if it has one, on the card if not, and
  // whichever colour it was given is held to that surface - the catalogue's
  // silver and gold plates are too pale for the white a bare name defaults to.
  const nameStops = nameplate ? colorsIn(nameplate) : surface.stops;
  const nameInk = nameplate ? inkForStops(nameStops).ink : ink.text;
  const onName = (color: string) => readableOn(color, nameStops, nameInk, READABLE_LC.text);
  const name: CSSProperties = {
    fontFamily: FONTS.find((font) => font.id === (nameStyle.font ?? "default"))?.css ?? "inherit",
    fontWeight: nameStyle.bold === false ? 600 : 700,
    fontStyle: nameStyle.italic ? "italic" : "normal",
    color: nameStyle.color ? onName(nameStyle.color) : nameInk,
    ...(nameStyle.glow ? { textShadow: `0 0 ${nameStyle.glow.size}px ${nameStyle.glow.color}` } : {}),
    ...(nameStyle.gradient
      ? {
          color: "transparent",
          background: `linear-gradient(135deg,${nameStyle.gradient.map(onName).join(",")})`,
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
        }
      : {}),
  };

  return {
    card,
    ground,
    banner,
    bannerScrim,
    // A photograph is not read, so its chrome is simply dark enough for most;
    // a flat banner is, and the wash deepens until white reads on it.
    bannerChrome: image
      ? "rgba(0,0,0,.45)"
      : `rgba(0,0,0,${scrimAlpha(bannerStops, READABLE_LC.text, 0.28)})`,
    avatarRing,
    avatarFill: tint.mid,
    avatarInk: textColorForBg(tint.mid),
    nameplate,
    name,
    decoration,
    ink,
    send: accent
      ? {
          background: `linear-gradient(90deg,${palette?.borderColor ?? accent},${accent})`,
          color: textColorForGradient([palette?.borderColor ?? accent, accent]),
        }
      : { background: tokens.accent, color: textColorForBg(tokens.accent) },
  };
}
