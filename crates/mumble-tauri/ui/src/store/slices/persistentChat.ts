/**
 * Persistent-chat (pchat) store slice.
 *
 * The first extraction in the `store.ts` split: a canonical Zustand
 * `StateCreator` slice owning the persistent-chat state (key trust, custodian
 * pinning, key disputes, key-share consent, key-holder tracking, history
 * pagination) and its actions. Combined into the root store in `../../store`
 * via `...createPersistentChatSlice(...)`.
 *
 * `AppState` is imported **type-only**, so the `store <-> slice` import cycle is
 * eval-safe (nothing here touches the store at module-eval time - the injected
 * `set`/`get` are only used inside action bodies, by which point both modules
 * are fully loaded). Companion event listeners live in `./persistentChat.events`.
 */

import { invoke } from "@tauri-apps/api/core";
import type { StateCreator } from "zustand";
import type {
  ChannelPersistenceState,
  KeyTrustState,
  CustodianPinState,
  PendingDispute,
  PendingKeyShareRequest,
  KeyHolderEntry,
  PersistenceMode,
  ChannelPersistConfig,
} from "../../types";
import type { AppState } from "../../store";

/** State + actions for the persistent-chat concern. `AppState` extends this. */
export interface PersistentChatSlice {
  /** Persistence metadata per channel (mode, retention, fetch state). */
  channelPersistence: Record<number, ChannelPersistenceState>;
  /** Key trust state per channel (trust level, fingerprints, distributor). */
  keyTrust: Record<number, KeyTrustState>;
  /** Custodian pin state per channel (TOFU pinning). */
  custodianPins: Record<number, CustodianPinState>;
  /** Pending key disputes per channel. */
  pendingDisputes: Record<number, PendingDispute>;
  /** Channels currently loading history (awaiting key exchange + fetch). */
  pchatHistoryLoading: Set<number>;
  /** Pending key-share consent requests per channel. */
  pendingKeyShares: Record<number, PendingKeyShareRequest[]>;
  /** Server-tracked key holders per channel. */
  keyHolders: Record<number, KeyHolderEntry[]>;
  /** Channels where the key-possession challenge failed (key revoked). */
  pchatKeyRevoked: Set<number>;
  /** Error message when the signal bridge library fails to load. */
  signalBridgeError: string | null;

  fetchHistory: (channelId: number, beforeId?: string) => Promise<void>;
  getPersistenceMode: (channelId: number) => PersistenceMode;
  verifyKeyFingerprint: (channelId: number) => Promise<void>;
  acceptCustodianChanges: (channelId: number) => Promise<void>;
  confirmCustodians: (channelId: number) => Promise<void>;
  resolveKeyDispute: (channelId: number, trustedSenderHash: string) => Promise<void>;
  updateChannelPersistenceConfig: (channelId: number, config: ChannelPersistConfig) => void;
  approveKeyShare: (channelId: number, peerCertHash: string) => Promise<void>;
  dismissKeyShare: (channelId: number, peerCertHash: string) => Promise<void>;
  queryKeyHolders: (channelId: number) => Promise<void>;
  deletePchatMessages: (channelId: number, opts: {
    messageIds?: string[];
    timeFrom?: number;
    timeTo?: number;
    senderHash?: string;
  }) => Promise<void>;
}

/** State-only portion of {@link PersistentChatSlice}. */
type PersistentChatState = Pick<
  PersistentChatSlice,
  | "channelPersistence"
  | "keyTrust"
  | "custodianPins"
  | "pendingDisputes"
  | "pchatHistoryLoading"
  | "pendingKeyShares"
  | "keyHolders"
  | "pchatKeyRevoked"
  | "signalBridgeError"
>;

/**
 * Default persistent-chat state. The single source of truth, used both by the
 * slice (initial state) and by the root store's `INITIAL` (so `reset()` /
 * disconnect / switchServer clear pchat state along with everything else).
 */
export const persistentChatInitialState: PersistentChatState = {
  channelPersistence: {},
  keyTrust: {},
  custodianPins: {},
  pendingDisputes: {},
  pchatHistoryLoading: new Set(),
  pendingKeyShares: {},
  keyHolders: {},
  pchatKeyRevoked: new Set(),
  signalBridgeError: null,
};

export const createPersistentChatSlice: StateCreator<AppState, [], [], PersistentChatSlice> = (
  set,
  get,
) => ({
  ...persistentChatInitialState,

  fetchHistory: async (channelId, beforeId) => {
    set((prev) => ({
      channelPersistence: {
        ...prev.channelPersistence,
        [channelId]: {
          ...prev.channelPersistence[channelId],
          isFetching: true,
        },
      },
    }));
    try {
      // Fire-and-forget: the response arrives asynchronously via
      // "pchat-fetch-complete" and "new-message" events.
      await invoke<void>("fetch_older_messages", {
        channelId,
        beforeId: beforeId ?? null,
        limit: 50,
      });
    } catch (e) {
      console.error("fetch_older_messages error:", e);
      set((prev) => ({
        channelPersistence: {
          ...prev.channelPersistence,
          [channelId]: {
            ...prev.channelPersistence[channelId],
            isFetching: false,
          },
        },
      }));
    }
  },

  getPersistenceMode: (channelId) => {
    return get().channelPersistence[channelId]?.mode ?? "NONE";
  },

  verifyKeyFingerprint: async (channelId) => {
    try {
      await invoke("verify_channel_key_manual", { channelId });
      set((prev) => ({
        keyTrust: {
          ...prev.keyTrust,
          [channelId]: {
            ...prev.keyTrust[channelId],
            trustLevel: "ManuallyVerified",
          },
        },
      }));
    } catch (e) {
      console.error("verify_channel_key_manual error:", e);
    }
  },

  acceptCustodianChanges: async (channelId) => {
    try {
      await invoke("accept_custodian_changes", { channelId });
      set((prev) => {
        const pin = prev.custodianPins[channelId];
        if (!pin?.pendingUpdate) return {};
        return {
          custodianPins: {
            ...prev.custodianPins,
            [channelId]: {
              pinned: pin.pendingUpdate,
              confirmed: true,
              pendingUpdate: null,
            },
          },
        };
      });
    } catch (e) {
      console.error("accept_custodian_changes error:", e);
    }
  },

  confirmCustodians: async (channelId) => {
    try {
      const { custodianPins } = get();
      const pin = custodianPins[channelId];
      if (!pin) return;
      await invoke("confirm_custodians", {
        channelId,
        custodianHashes: pin.pinned,
      });
      set((prev) => ({
        custodianPins: {
          ...prev.custodianPins,
          [channelId]: { ...prev.custodianPins[channelId], confirmed: true },
        },
      }));
    } catch (e) {
      console.error("confirm_custodians error:", e);
    }
  },

  resolveKeyDispute: async (channelId, trustedSenderHash) => {
    try {
      await invoke("resolve_key_dispute", { channelId, trustedSenderHash });
      set((prev) => {
        const { [channelId]: _removed, ...rest } = prev.pendingDisputes;
        return {
          pendingDisputes: rest,
          keyTrust: {
            ...prev.keyTrust,
            [channelId]: {
              ...prev.keyTrust[channelId],
              trustLevel: "ManuallyVerified",
            },
          },
        };
      });
    } catch (e) {
      console.error("resolve_key_dispute error:", e);
    }
  },

  updateChannelPersistenceConfig: (channelId, config) => {
    set((prev) => ({
      channelPersistence: {
        ...prev.channelPersistence,
        [channelId]: {
          mode: config.mode,
          maxHistory: config.maxHistory,
          retentionDays: config.retentionDays,
          hasMore: false,
          isFetching: false,
          totalStored: prev.channelPersistence[channelId]?.totalStored ?? 0,
        },
      },
    }));
  },

  approveKeyShare: async (channelId, peerCertHash) => {
    try {
      await invoke("approve_key_share", { channelId, peerCertHash });
    } catch (e) {
      console.error("approve_key_share error:", e);
    }
  },

  dismissKeyShare: async (channelId, peerCertHash) => {
    try {
      await invoke("dismiss_key_share", { channelId, peerCertHash });
    } catch (e) {
      console.error("dismiss_key_share error:", e);
    }
  },

  queryKeyHolders: async (channelId) => {
    try {
      await invoke("query_key_holders", { channelId });
    } catch (e) {
      console.error("query_key_holders error:", e);
    }
  },

  deletePchatMessages: async (channelId, opts) => {
    try {
      await invoke("delete_pchat_messages", {
        channelId,
        messageIds: opts.messageIds ?? [],
        timeFrom: opts.timeFrom ?? null,
        timeTo: opts.timeTo ?? null,
        senderHash: opts.senderHash ?? null,
      });

      // The invoke resolves only after the server's PchatAck confirms
      // success, so it is safe to remove the messages locally now.
      if (opts.messageIds && opts.messageIds.length > 0) {
        const removed = new Set(opts.messageIds);
        set((prev) => ({
          messages: prev.messages.filter(
            (m) => !m.message_id || !removed.has(m.message_id),
          ),
        }));
      } else {
        // For time-range or sender-hash deletions we cannot determine
        // which messages were affected locally, so re-fetch from the
        // backend.
        await get().refreshMessages(channelId);
      }
    } catch (e) {
      console.error("delete_pchat_messages error:", e);
      throw e;
    }
  },
});
