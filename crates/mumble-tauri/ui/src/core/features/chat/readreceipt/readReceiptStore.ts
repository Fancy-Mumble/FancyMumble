/**
 * In-memory read receipt store.
 *
 * Read receipts arrive via FancyReadReceiptDeliver (wire ID 127).
 * Each entry tracks a user's read watermark (last_read_message_id)
 * for a channel, keyed by cert_hash.
 */

import type { ReadState } from "../../../types";

/**
 * Where each message sits in its conversation, oldest first.
 *
 * A receipt is a watermark - one message id per person - so "who has read this
 * one" is a question about positions in the conversation. Asked of the ordered
 * list directly it is an `indexOf` per reader per message, which the message
 * river turned into millions of string comparisons per render. Asked of this,
 * it is a lookup.
 */
export type MessageOrder = ReadonlyMap<string, number>;

/**
 * One index per list, kept for as long as that list is the live one.
 *
 * Keyed on the array itself, so a caller that hands over the same memoised list
 * on every render builds the index once, and one that hands over a fresh copy
 * pays for it - which is the honest way round.
 */
const indexes = new WeakMap<readonly string[], MessageOrder>();

/** The index for this ordered list of ids, built at most once per list. */
export function messageOrderOf(ids: readonly string[]): MessageOrder {
  const cached = indexes.get(ids);
  if (cached) return cached;
  const order = new Map<string, number>();
  for (const [index, id] of ids.entries()) if (!order.has(id)) order.set(id, index);
  indexes.set(ids, order);
  return order;
}

/** Either form a caller may hold: the ordered ids, or an index over them. */
export type MessagePositions = readonly string[] | MessageOrder;

function positionsOf(given: MessagePositions): MessageOrder {
  return Array.isArray(given) ? messageOrderOf(given) : (given as MessageOrder);
}

// -- Module-level store -------------------------------------------

/**
 * channelId -> cert_hash -> ReadState
 *
 * Mutable maps for performance; components trigger re-renders via
 * Zustand `setState({})` after mutations (same pattern as reactions).
 */
const readStateMap = new Map<number, Map<string, ReadState>>();

// -- Accessors ----------------------------------------------------

/** Get all read states for a channel. */
export function getChannelReadStates(channelId: number): ReadState[] {
  const byHash = readStateMap.get(channelId);
  if (!byHash) return [];
  return [...byHash.values()];
}

/** Check whether a specific user (by cert_hash) has read at least up to a given message. */
export function hasUserReadMessage(
  channelId: number,
  certHash: string,
  messageId: string,
  allMessageIds: MessagePositions,
): boolean {
  const byHash = readStateMap.get(channelId);
  if (!byHash) return false;
  const state = byHash.get(certHash);
  if (!state) return false;

  const order = positionsOf(allMessageIds);
  const watermarkIdx = order.get(state.last_read_message_id);
  const messageIdx = order.get(messageId);
  if (watermarkIdx === undefined || messageIdx === undefined) return false;
  return watermarkIdx >= messageIdx;
}

/**
 * Get the list of users who have read a specific message in a channel.
 * `allMessageIds` is the ordered list of message IDs in the channel
 * (oldest first) used to compare watermark positions.
 */
export function getReadersForMessage(
  channelId: number,
  messageId: string,
  allMessageIds: MessagePositions,
): ReadState[] {
  const byHash = readStateMap.get(channelId);
  if (!byHash) return [];

  const order = positionsOf(allMessageIds);
  const targetIdx = order.get(messageId);
  if (targetIdx === undefined) return [];

  const readers: ReadState[] = [];
  for (const state of byHash.values()) {
    const watermarkIdx = order.get(state.last_read_message_id);
    if (watermarkIdx !== undefined && watermarkIdx >= targetIdx) {
      readers.push(state);
    }
  }
  return readers;
}

/**
 * Check if ALL active channel users (excluding the sender) have read
 * a given message. Used for the double-checkmark indicator.
 */
export function allActiveUsersRead(
  channelId: number,
  messageId: string,
  allMessageIds: MessagePositions,
  activeUserHashes: readonly string[],
  ownCertHash: string | undefined,
): boolean {
  if (activeUserHashes.length === 0) return false;
  const othersHashes = ownCertHash ? activeUserHashes.filter((h) => h !== ownCertHash) : activeUserHashes;
  if (othersHashes.length === 0) return true;

  const order = positionsOf(allMessageIds);
  const targetIdx = order.get(messageId);
  if (targetIdx === undefined) return false;

  const byHash = readStateMap.get(channelId);
  if (!byHash) return false;

  return othersHashes.every((hash) => {
    const state = byHash.get(hash);
    if (!state) return false;
    const watermarkIdx = order.get(state.last_read_message_id);
    return watermarkIdx !== undefined && watermarkIdx >= targetIdx;
  });
}

// -- Mutations ----------------------------------------------------

/** Apply incoming read states (from a FancyReadReceiptDeliver event). */
export function applyReadStates(channelId: number, states: ReadState[]): void {
  let byHash = readStateMap.get(channelId);
  if (!byHash) {
    byHash = new Map();
    readStateMap.set(channelId, byHash);
  }
  for (const rs of states) {
    if (!rs.cert_hash) continue;
    const existing = byHash.get(rs.cert_hash);
    if (!existing || rs.timestamp >= existing.timestamp) {
      byHash.set(rs.cert_hash, rs);
    }
  }
}

/** Clear all read receipt data (e.g. on disconnect). */
export function clearReadReceipts(): void {
  readStateMap.clear();
}
