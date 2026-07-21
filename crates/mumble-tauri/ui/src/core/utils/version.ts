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
