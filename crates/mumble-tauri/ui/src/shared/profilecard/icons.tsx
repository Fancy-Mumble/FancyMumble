/**
 * The card's own glyphs.
 *
 * The client draws its chrome with `lucide-react`, which the channel viewer
 * does not depend on. A card that imported it would be a card only one of the
 * two hosts could mount, so the handful of glyphs the card itself needs are
 * inlined here as plain SVG: no package, no icon font, and the same shapes on
 * both sides.
 */
import type { SVGProps } from "react";

export type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function icon(path: React.ReactNode, filled = false) {
  return function Glyph({ size = 12, ...rest }: IconProps) {
    return (
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth={filled ? 0 : 2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        focusable="false"
        {...rest}
      >
        {path}
      </svg>
    );
  };
}

export const StarGlyph = icon(
  <path d="m12 2.6 2.9 5.9 6.5.95-4.7 4.6 1.1 6.45L12 17.45 6.2 20.5l1.1-6.45-4.7-4.6 6.5-.95Z" />,
  true,
);
export const ShieldGlyph = icon(
  <>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
    <path d="m9 12 2 2 4-4" />
  </>,
);
export const CheckGlyph = icon(<path d="M20 6 9 17l-5-5" />);
export const VerifiedGlyph = icon(
  <>
    <path
      d="M12 1.8 14.4 4l3.1-.3 1.2 2.9 2.9 1.2-.3 3.1 2.2 2.4-2.2 2.4.3 3.1-2.9 1.2-1.2 2.9-3.1-.3L12 24.6 9.6 22.4l-3.1.3-1.2-2.9-2.9-1.2.3-3.1L.5 13.3l2.2-2.4-.3-3.1 2.9-1.2L6.5 3.7l3.1.3Z"
      transform="scale(.86) translate(2 1)"
    />
    <path d="m8.6 12.2 2.4 2.4 4.6-4.8" strokeWidth={2.4} />
  </>,
);
export const CrownGlyph = icon(<path d="M3 7l4 4 5-7 5 7 4-4-2 12H5L3 7Z" />, true);
export const HeartGlyph = icon(<path d="M12 20.5 3.9 12.6a5 5 0 0 1 7.1-7l1 1 1-1a5 5 0 1 1 7.1 7Z" />, true);
export const ZapGlyph = icon(<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />, true);
export const FlameGlyph = icon(
  <path d="M12 2c3 4 6 6 6 10a6 6 0 0 1-12 0c0-2 1-3.5 2-5 .4 1.6 1.3 2.4 2 2.4 1.3 0 2-2.6 2-7.4Z" />,
  true,
);
export const SnowGlyph = icon(
  <>
    <path d="M12 2v20M4.2 6.5l15.6 9M19.8 6.5l-15.6 9" />
    <path d="m9 4 3 3 3-3M9 20l3-3 3 3" />
  </>,
);
export const SparkleGlyph = icon(<path d="M12 2.5 14 9l6.5 2-6.5 2-2 6.5-2-6.5L3.5 11 10 9Z" />, true);
export const AwardGlyph = icon(
  <>
    <circle cx="12" cy="9" r="6" />
    <path d="m8.5 14-1.5 8 5-3 5 3-1.5-8" />
  </>,
);
export const MicGlyph = icon(
  <>
    <rect x="9" y="2" width="6" height="11" rx="3" />
    <path d="M5 10a7 7 0 0 0 14 0M12 17v5" />
  </>,
);
export const MicOffGlyph = icon(
  <>
    <path d="M2 2l20 20" />
    <path d="M15 9.3V5a3 3 0 0 0-5.9-.7M9 9v1a3 3 0 0 0 4.6 2.5" />
    <path d="M5 10a7 7 0 0 0 10.6 6M19 10v-.6M12 17v5" />
  </>,
);
export const HeadphonesOffGlyph = icon(
  <>
    <path d="M2 2l20 20" />
    <path d="M4 15v-3a8 8 0 0 1 12.4-6.7M20 12v5" />
    <path d="M4 15h2a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2v-4M18 15h1a2 2 0 0 1 2 2v2" />
  </>,
);
export const SendGlyph = icon(<path d="M22 2 11 13M22 2l-7 20-4-9-9-4Z" />);
export const CloseGlyph = icon(<path d="M18 6 6 18M6 6l12 12" />);
export const PencilGlyph = icon(<path d="M17 3.5a2.1 2.1 0 0 1 3 3L7.5 19 3 20.5 4.5 16Z" />);
export const UsersGlyph = icon(
  <>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" />
  </>,
);
export const GamepadGlyph = icon(
  <>
    <path d="M6 12h4M8 10v4M15 13h.01M18 11h.01" />
    <rect x="2" y="6" width="20" height="12" rx="5" />
  </>,
);
export const CircleGlyph = icon(<circle cx="12" cy="12" r="8" />, true);
export const DiamondGlyph = icon(<path d="m12 2 10 10-10 10L2 12Z" />, true);

/** Every glyph a server may name, keyed by the id it sends. */
export const BADGE_GLYPHS = {
  star: StarGlyph,
  shield: ShieldGlyph,
  check: CheckGlyph,
  verified: VerifiedGlyph,
  crown: CrownGlyph,
  heart: HeartGlyph,
  zap: ZapGlyph,
  flame: FlameGlyph,
  snow: SnowGlyph,
  sparkle: SparkleGlyph,
  award: AwardGlyph,
  mic: MicGlyph,
  "mic-off": MicOffGlyph,
  "headphones-off": HeadphonesOffGlyph,
  users: UsersGlyph,
  circle: CircleGlyph,
  diamond: DiamondGlyph,
} as const;

export type BadgeGlyphName = keyof typeof BADGE_GLYPHS;

/** Whether a server-sent glyph id is one the card knows how to draw. */
export function isBadgeGlyphName(name: string): name is BadgeGlyphName {
  return name in BADGE_GLYPHS;
}
