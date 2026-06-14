/**
 * Render a small flag for a {@link LanguageEntry}.
 *
 * Windows ships no emoji-flag glyphs, so the cross-platform 🇺🇸-style
 * emoji from `language-flag-colors` renders as "US" / "DE" / etc. on
 * that platform - visible-but-ugly.  To get a real flag everywhere we
 * pull the matching SVG from `country-flag-icons` (already a
 * dependency) using its registry export.
 *
 * Importing the whole namespace pulls in ~1.4 MB of SVGs at build time.
 * Acceptable because the translation helper is a developer-mode tool -
 * the cost only lands when that popout is opened, not in the main app
 * bundle's hot path.  Languages whose `countryCode` has no matching
 * SVG (and `entry === null`) fall back to the language emoji and
 * finally to the 🌐 globe.
 */

import type { ComponentType, CSSProperties } from "react";
import * as Flags from "country-flag-icons/react/3x2";
import type { LanguageEntry } from "./languageData";

type FlagComponent = ComponentType<{
  readonly style?: CSSProperties;
  readonly title?: string;
  readonly className?: string;
}>;

/** Country-code -> SVG component lookup, narrowed from the wide
 *  namespace import to something we can index safely. */
const FLAG_REGISTRY = Flags as unknown as Record<string, FlagComponent>;

interface Props {
  readonly entry: LanguageEntry | null;
  readonly size?: number;
  readonly title?: string;
}

export default function LanguageFlag({ entry, size = 18, title }: Props) {
  const wrapperStyle: CSSProperties = {
    width: size,
    height: Math.round(size * 0.75),
    display: "inline-block",
    fontSize: Math.round(size * 0.9),
    lineHeight: 1,
    textAlign: "center",
    overflow: "hidden",
    borderRadius: 2,
  };

  if (!entry) {
    return <span style={wrapperStyle} aria-hidden="true">🌐</span>;
  }

  const Svg = entry.countryCode ? FLAG_REGISTRY[entry.countryCode] : undefined;
  const displayTitle = title ?? entry.englishName;

  if (Svg) {
    return (
      <Svg
        style={{ ...wrapperStyle, objectFit: "cover" }}
        title={displayTitle}
      />
    );
  }

  return (
    <span style={wrapperStyle} title={displayTitle}>
      {entry.emoji || "🌐"}
    </span>
  );
}
