/**
 * The shared profile card.
 *
 * One component, painted from one resolver, filled by whichever host is
 * mounting it - the desktop client's Nebula pack or the standalone channel
 * viewer. Everything a host needs is exported here; nothing inside imports
 * from a host, which is what keeps the two from drifting.
 */
export { ProfileCard, type CardAction, type ProfileCardProps } from "./ProfileCard";
export {
  BADGE_STRIP_LIMIT,
  SHELF_NODE_LIMIT,
  arrangeBadges,
  badgeFromGroup,
  badgesFromState,
  formatCount,
  formatSpan,
  showsSection,
  type BadgeGlyph,
  type BadgeShelf,
  type BadgeSource,
  type CardActivity,
  type CardPresence,
  type CardStat,
  type PresenceTone,
  type ProfileBadge,
  type ProfileCardModel,
  type ProfileGroupSource,
  type ProfileRole,
  type UserStateFlags,
} from "./model";
export { resolveProfilePaint, type ProfileInk, type ProfilePaint, type ProfileSticker } from "./paint";
export {
  RichText,
  isRichTextEmpty,
  parseRichText,
  richTextToPlain,
  type RichNode,
  type RichTag,
  type RichTextProps,
} from "./richText";
export { PROFILE_CARD_TOKENS, type ProfileCardTokens } from "./tokens";
export {
  placeBesideAnchor,
  pointAnchor,
  type AnchorRect,
  type CardPlacement,
  type PlacementOptions,
  type Viewport,
} from "./placement";
export { userTint, hueFromKey, type UserTint } from "./tint";
export { parseComment, serializeProfile } from "./profileFormat";
export {
  READABLE_LC,
  buildGradient,
  colorsIn,
  contrastLc,
  inkForStops,
  over,
  readableAlpha,
  readableOn,
  readableStops,
  resolveThemePalette,
  textColorForBg,
  textColorForGradient,
  withAlpha,
} from "./color";
export type { FancyProfile, ProfileSections } from "./profileTypes";
export { AVATAR_BORDERS, DECORATIONS, EFFECTS, FONTS, NAMEPLATES } from "./catalog";
export {
  BADGE_GLYPHS,
  MicOffGlyph,
  PencilGlyph,
  SendGlyph,
  isBadgeGlyphName,
  type BadgeGlyphName,
  type IconProps,
} from "./icons";
