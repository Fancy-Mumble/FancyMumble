/** FancyMumble profile customisation embedded in the Mumble user comment. */

/**
 * Which of the card's optional rows the owner wants drawn.
 *
 * Absent means "show it": a profile written before a row existed must not
 * silently hide it, and a user who has never opened settings gets the full
 * card rather than a stripped one.
 */
export interface ProfileSections {
  badges?: boolean;
  /** The badge shelves under the activity row. */
  shelves?: boolean;
  identity?: boolean;
  status?: boolean;
  bio?: boolean;
  mutual?: boolean;
  roles?: boolean;
  activity?: boolean;
  stats?: boolean;
}

/**
 * Profile customisation data embedded in the Mumble user comment.
 *
 * Everything except the avatar texture is stored here.  Binary values
 * (banner images) are base64 data-URIs because the comment protobuf
 * field is `string` (UTF-8 only).
 */
export interface FancyProfile {
  /** Format version - always `1`. */
  v?: 1;
  /** Avatar frame decoration id. */
  decoration?: string;
  /** Custom sticker image as a data-URI, used when `decoration` is "custom". */
  decorationImage?: string;
  /** Nameplate style id. */
  nameplate?: string;
  /** Animated profile effect id (e.g. "particles", "rain", "pulse_glow"). */
  effect?: string;
  /** Banner configuration. */
  banner?: {
    /** Background colour (hex). */
    color?: string;
    /** Banner image as a data-URI. */
    image?: string;
  };
  /** Name rendering style. */
  nameStyle?: {
    font?: string;
    color?: string;
    gradient?: [string, string];
    glow?: { color: string; size: number };
    bold?: boolean;
    italic?: boolean;
  };
  /** Card background preset id or custom CSS value. */
  cardBackground?: string;
  /** Custom card background (only used when cardBackground is "custom"). */
  cardBackgroundCustom?: string;
  /** User-chosen theme colours (1-5 hex values) for gradient card background,
   *  border accents, and adaptive text colour. */
  themeColors?: string[];
  /** Enable frosted-glass overlay on the card background. */
  cardGlass?: boolean;
  /** Avatar border style preset id. */
  avatarBorder?: string;
  /** Custom avatar border CSS (only used when avatarBorder is "custom"). */
  avatarBorderCustom?: string;
  /** Custom user status (shown below the name); inline formatting, one line. */
  status?: string;
  /** Pronouns, drawn on the identity line beside `contact`. */
  pronouns?: string;
  /** Contact handle - an address, a fediverse handle, anything short. */
  contact?: string;
  /** Which optional rows the card draws. Absent keys mean "show". */
  sections?: ProfileSections;
}
