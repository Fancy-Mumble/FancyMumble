/**
 * The colour a subject keeps when it supplies none of its own.
 *
 * Both the client and the channel viewer draw cards for users who have never
 * opened a profile editor, and neither leaves them grey: a hue is hashed out of
 * the user's identity and every surface that needs a colour for them derives it
 * from the same hue. Living here rather than in one host's selectors is what
 * makes a face the same colour in both.
 */
import { hslToHex } from "./color";

/** The three stops of the banner an unstyled profile card is drawn with. */
export interface UserTint {
  from: string;
  /** The user's own colour: the banner's middle stop, and the avatar fill. */
  mid: string;
  to: string;
}

/**
 * The colour a user is assigned when their profile carries no banner.
 *
 * The mock's card is a three-stop rake with the user's colour in the middle and
 * a companion either side, and the same middle colour fills the avatar behind
 * their initials. Quieter than a server's pair - it sits directly behind a
 * name and a face, and has to stay a backdrop.
 */
export function userTint(key: string): UserTint {
  const hue = hueFromKey(key);
  return {
    from: hslToHex({ h: (hue + 173) % 360, s: 18, l: 56 }),
    mid: hslToHex({ h: hue, s: 18, l: 51 }),
    to: hslToHex({ h: (hue + 116) % 360, s: 13, l: 50 }),
  };
}

/**
 * A hue, 0-359, that a name or an address keeps for good.
 *
 * FNV-1a, stable across launches. The avalanche pass after it is what makes the
 * hue usable: FNV mixes into its high bits and the hue is taken from the low
 * ones, so without it `srv1` and `srv2` come out three degrees apart -
 * indistinguishable, which is the one thing an assigned colour must not be.
 */
export function hueFromKey(key: string): number {
  const seed = key.toLocaleLowerCase();
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return (hash >>> 0) % 360;
}
