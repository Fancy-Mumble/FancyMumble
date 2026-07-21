/** Persistent (E2EE) chat: per-channel persistence config, encryption-key
 *  trust / custodian state, stored-message history and key-share requests. */

/** Persistence protocol for a channel (maps to Rust PchatProtocol). */
export type PersistenceMode = "NONE" | "FANCY_V1_FULL_ARCHIVE" | "SIGNAL_V1";

/** Trust level for a channel's encryption key. */
export type KeyTrustLevel = "ManuallyVerified" | "Verified" | "Unverified" | "Disputed";

/** Persistence configuration for a channel. */
export interface ChannelPersistConfig {
  mode: PersistenceMode;
  maxHistory: number;
  retentionDays: number;
  keyCustodians: string[];
}

/** Per-channel persistence UI state tracked in the Zustand store. */
export interface ChannelPersistenceState {
  mode: PersistenceMode;
  maxHistory: number;
  retentionDays: number;
  hasMore: boolean;
  isFetching: boolean;
  totalStored: number;
}

/** Key trust state for a channel's encryption key. */
export interface KeyTrustState {
  trustLevel: KeyTrustLevel;
  fingerprint: KeyFingerprints;
  distributorName: string;
  distributorHash: string;
  lastChanged: number;
}

/** Fingerprint representations for a channel encryption key. */
export interface KeyFingerprints {
  emoji: string[];
  words: string[];
  hex: string;
}

/** Local custodian pin state persisted per channel. */
export interface CustodianPinState {
  pinned: string[];
  confirmed: boolean;
  pendingUpdate?: string[] | null;
}

/** A conflicting key in a dispute. */
export interface ConflictingKey {
  senderHash: string;
  senderName: string;
  fingerprint: string;
  timestamp: number;
}

/** Pending dispute state for a channel. */
export interface PendingDispute {
  conflictingKeys: ConflictingKey[];
  canResolve: boolean;
  selectedSenderHash?: string;
}

/** A stored persistent message returned from history fetch. */
export interface StoredMessage {
  messageId: string;
  channelId: number;
  timestamp: number;
  senderHash: string;
  senderName: string;
  body: string;
  encrypted: boolean;
  epoch?: number;
  chainIndex?: number;
  replacesId?: string | null;
}

/** Response from fetching persistent message history. */
export interface FetchHistoryResponse {
  channelId: number;
  messages: StoredMessage[];
  hasMore: boolean;
  totalStored: number;
}

/** A pending key-share request waiting for user approval. */
export interface PendingKeyShareRequest {
  channel_id: number;
  peer_cert_hash: string;
  peer_name: string;
}

/** A user known to hold the E2EE key for a channel. */
export interface KeyHolderEntry {
  cert_hash: string;
  name: string;
  is_online: boolean;
}
