/**
 * A channel's own look - its icon and its banner - carried in its description.
 *
 * The protocol has no field for either. A user's card solves the same problem
 * the same way: `profileFormat` hides a JSON payload in an HTML comment at the
 * head of the Mumble comment and leaves the visible bio after it, so a legacy
 * client renders the text and simply never shows the marker. This is that
 * trick applied to `ChannelState.description`, and the payload is deliberately
 * shaped like the user profile's `banner` so both sheets can hand it to
 * `resolveProfilePaint` and get one banner treatment rather than two.
 *
 * Format:
 *   <!--FANCYCHAN:{"v":1,"icon":"data:image/webp;base64,..."}-->
 *   (description HTML here)
 *
 * Images are data-URIs because `description` is a protobuf `string`: UTF-8
 * only, so binary has to be base64. They are also the reason the editor crops
 * and squeezes before it stores one - the description travels whole, and the
 * server's default `image_message_length` is 128 KiB for the lot.
 */

/** A channel's banner: an image, a flat colour, or neither. */
export interface ChannelBanner {
  /** Background colour (hex). */
  color?: string;
  /** Banner image as a data-URI. */
  image?: string;
}

/** What a channel says about its own appearance. */
export interface ChannelProfile {
  /** Format version - always `1`. */
  v?: 1;
  /** Channel icon as a data-URI. */
  icon?: string;
  banner?: ChannelBanner;
}

const PREFIX = "<!--FANCYCHAN:";
const SUFFIX = "-->";

/**
 * Split a description into the appearance it carries and the text it shows.
 *
 * A description written by any other client has no marker, and comes back
 * whole as the body with no appearance - which is exactly how it should
 * render.
 */
export function parseChannelDescription(description: string): {
  profile: ChannelProfile | null;
  body: string;
} {
  if (!description.startsWith(PREFIX)) return { profile: null, body: description };
  const end = description.indexOf(SUFFIX, PREFIX.length);
  if (end === -1) return { profile: null, body: description };

  const json = description.substring(PREFIX.length, end);
  const body = description.substring(end + SUFFIX.length).replace(/^\n/, "");
  try {
    return { profile: JSON.parse(json) as ChannelProfile, body };
  } catch {
    // A marker we cannot read is somebody else's text, not ours to eat.
    return { profile: null, body: description };
  }
}

/**
 * Put the two back together, for `update_channel`.
 *
 * An appearance with nothing in it writes no marker at all: a channel that
 * never had one, or that has just had its last image cleared, should go back
 * to being a plain description rather than carrying an empty payload forever.
 */
export function serializeChannelDescription(profile: ChannelProfile | null, body: string): string {
  if (!hasAppearance(profile)) return body;
  const payload: ChannelProfile = { ...profile, v: 1 };
  const json = JSON.stringify(payload, (_key, value: unknown) => (value === undefined ? undefined : value));
  return body ? `${PREFIX}${json}${SUFFIX}\n${body}` : `${PREFIX}${json}${SUFFIX}`;
}

/** Whether the profile actually sets anything a surface could draw. */
export function hasAppearance(profile: ChannelProfile | null | undefined): profile is ChannelProfile {
  if (!profile) return false;
  return !!profile.icon || !!profile.banner?.image || !!profile.banner?.color;
}
