import type { BanEntry, WireBanEntry } from "../../types";

/**
 * A ban's mask as an administrator thinks of it, and as the wire carries it.
 *
 * Mumble's `BanList` carries every address in sixteen bytes, an IPv4 one as
 * `::ffff:a.b.c.d`, and its mask counts the bits that matter over all
 * sixteen: one IPv4 address is 128 there, an IPv4 /24 is 120. A mask of 32
 * sent for an IPv4 address therefore covers only the zero bits in front of
 * every mapped address, which is a ban on all of IPv4.
 *
 * The UI works in the address's own terms (IPv4 0 to 32, IPv6 0 to 128) and
 * turns the count here, at the one place the list crosses into or out of the
 * engine, and nowhere else.
 */

/** The fixed bits every IPv4 address is carried behind on the wire. */
const V4_PREFIX = 96;

const V4_BITS = 32;
const V6_BITS = 128;

const V4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
/** An IPv4 address written in its mapped IPv6 form. */
const MAPPED_PATTERN = /^(?:::|(?:0{1,4}:){5})ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i;

/** The four octets of a dotted IPv4 address, or `null` when it is not one. */
function v4Octets(address: string): number[] | null {
  const match = V4_PATTERN.exec(address);
  if (!match) return null;
  const octets = match.slice(1).map(Number);
  return octets.every((octet) => octet <= 255) ? octets : null;
}

/**
 * The address as the UI shows it: an IPv4 address in its mapped IPv6 form is
 * written as the IPv4 address it is, everything else is left as it was typed.
 */
export function plainAddress(address: string): string {
  const trimmed = address.trim();
  const mapped = MAPPED_PATTERN.exec(trimmed);
  return mapped && v4Octets(mapped[1]) ? mapped[1] : trimmed;
}

/** Whether `address` is an IPv4 address, written plainly or mapped. */
export function isV4(address: string): boolean {
  return v4Octets(plainAddress(address)) !== null;
}

/**
 * The most bits a mask on `address` can count in the UI's terms: 32 for an
 * IPv4 address, 128 for anything else (IPv6, or an address not finished yet).
 */
export function maxMask(address: string): number {
  return isV4(address) ? V4_BITS : V6_BITS;
}

function clampMask(mask: number, max: number): number {
  if (!Number.isFinite(mask)) return max;
  return Math.min(Math.max(Math.trunc(mask), 0), max);
}

/** The wire's count for `mask` bits of `address`. */
export function maskToWire(address: string, mask: number): number {
  return isV4(address) ? clampMask(mask, V4_BITS) + V4_PREFIX : clampMask(mask, V6_BITS);
}

/**
 * The bits of `address` a wire count of `wire` covers. A wire count shorter
 * than the IPv4 prefix on an IPv4 address covers every IPv4 address, which
 * is shown as `/0`: what it really does, not what it was meant to do.
 */
export function maskFromWire(address: string, wire: number): number {
  return isV4(address) ? clampMask(wire - V4_PREFIX, V4_BITS) : clampMask(wire, V6_BITS);
}

/** A ban as the engine sends it, in the UI's terms. */
export function banFromWire(ban: WireBanEntry): BanEntry {
  const address = plainAddress(ban.address);
  return { ...ban, address, mask: maskFromWire(address, ban.mask) };
}

/** A ban in the UI's terms, as the engine expects it. */
export function banToWire(ban: BanEntry): WireBanEntry {
  const address = plainAddress(ban.address);
  return { ...ban, address, mask: maskToWire(address, ban.mask) };
}

/**
 * `ban` with its address changed to `address`. A mask that covered the whole
 * of the old address keeps covering the whole of the new one, so typing an
 * IPv4 address into a fresh entry bans that address and nothing more, and
 * typing an IPv6 one does not leave it at an IPv4-sized /32.
 */
export function withAddress(ban: BanEntry, address: string): BanEntry {
  const whole = ban.mask >= maxMask(ban.address);
  return { ...ban, address, mask: whole ? maxMask(address) : clampMask(ban.mask, maxMask(address)) };
}

/** The sixteen bytes `address` travels in, or `null` when it is not an address. */
function addressBytes(address: string): number[] | null {
  const plain = plainAddress(address);
  const v4 = v4Octets(plain);
  if (v4) return [...new Array<number>(10).fill(0), 0xff, 0xff, ...v4];
  if (!/^[0-9a-f:]+$/i.test(plain)) return null;
  const halves = plain.split("::");
  if (halves.length > 2) return null;
  const groups = (part: string) => (part === "" ? [] : part.split(":"));
  const head = groups(halves[0]);
  const tail = halves.length === 2 ? groups(halves[1]) : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const all = [...head, ...new Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (all.some((group) => group.length === 0 || group.length > 4)) return null;
  return all.flatMap((group) => {
    const value = parseInt(group, 16);
    return [value >> 8, value & 0xff];
  });
}

/**
 * Whether `ban` covers `address`, matched the way the server matches it: the
 * first `mask` bits of the two sixteen-byte forms agree.
 */
export function banCovers(ban: BanEntry, address: string): boolean {
  const banned = addressBytes(ban.address);
  const candidate = addressBytes(address);
  if (!banned || !candidate) return plainAddress(ban.address) === plainAddress(address);
  const bits = maskToWire(ban.address, ban.mask);
  for (let bit = 0; bit < bits; bit++) {
    const byte = bit >> 3;
    const flag = 0x80 >> (bit & 7);
    if ((banned[byte] & flag) !== (candidate[byte] & flag)) return false;
  }
  return true;
}
