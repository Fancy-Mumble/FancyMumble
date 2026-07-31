import type { ChannelEntry } from "@core/types";

/**
 * Mirrors the `ChannelAttribute` enum in `Mumble.proto`. Values are the proto
 * discriminants, and the channel's `attributes` bitmask sets bit N for
 * attribute N.
 *
 * Append new attributes here as the protocol gains them - nothing else in the
 * client needs to change to make one readable.
 */
export const ChannelAttribute = {
  CanEnter: 1,
  EnterRestricted: 2,
  Hidden: 3,
  Temporary: 4,
  Detached: 5,
  Structural: 6,
} as const;

export type ChannelAttributeValue = (typeof ChannelAttribute)[keyof typeof ChannelAttribute];

/** Whether the server advertised `attribute` for `channel`. */
export function hasChannelAttribute(
  channel: Pick<ChannelEntry, "attributes">,
  attribute: ChannelAttributeValue,
): boolean {
  // Bit 31 and above would overflow the signed 32-bit result of `<<`, so the
  // shift is done in BigInt space. Attribute values stay far below that today,
  // but silently misreading a future one would be a nasty bug to track down.
  const mask = channel.attributes ?? 0;
  return (BigInt(mask) & (1n << BigInt(attribute))) !== 0n;
}

/**
 * Whether the channel exists only to organise the tree: it cannot be entered
 * and never holds users, so viewers render it as a heading for the channels
 * nested beneath it.
 */
export function isStructuralChannel(channel: Pick<ChannelEntry, "attributes">): boolean {
  return hasChannelAttribute(channel, ChannelAttribute.Structural);
}
