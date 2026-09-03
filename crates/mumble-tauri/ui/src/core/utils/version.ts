/**
 * Encode a Fancy Mumble version using the Mumble v2 scheme:
 * `(major << 48) | (minor << 32) | (patch << 16)`.
 *
 * Mirrors `fancy_version_encode` from the `fancy-utils` Rust crate.
 *
 * Note: JavaScript's bitwise operators only work on 32-bit integers, so we
 * use regular arithmetic instead of shifts for the upper 32 bits.
 */
export function fancyVersionEncode(major: number, minor: number, patch: number): number {
  return major * 2 ** 48 + minor * 2 ** 32 + patch * 2 ** 16;
}

/**
 * Decode a Mumble v2-encoded version back into "major.minor.patch".
 *
 * The inverse of {@link fancyVersionEncode}, and division rather than shifts
 * for the same reason: the major and minor halves live above bit 32.
 */
export function fancyVersionDecode(version: number): string {
  const major = Math.trunc(version / 2 ** 48) & 0xffff;
  const minor = Math.trunc(version / 2 ** 32) & 0xffff;
  const patch = Math.trunc(version / 2 ** 16) & 0xffff;
  return `${major}.${minor}.${patch}`;
}
