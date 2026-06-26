/**
 * Persistent-chat Tauri event listeners.
 *
 * Registers the `pchat-*` events that drive the {@link PersistentChatSlice}
 * (key trust, custodian pinning, disputes, key-share consent, key-holder
 * tracking, history pagination) plus reaction/pin delivery over persistent
 * channels. Split out of `store.ts`; uses the free-function-over-`useAppStore`
 * style of the rest of the event wiring. `initEventListeners` calls
 * {@link registerPersistentChatEvents}, passing its `unlisteners` array.
 */

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useAppStore } from "../../store";
import { TauriEvent } from "../../constants/tauriEvents";
import { applyReaction } from "../../components/chat/reaction/reactionStore";
import type {
  ChannelPersistConfig,
  KeyTrustState,
  CustodianPinState,
  PendingDispute,
  PendingKeyShareRequest,
  KeyHolderEntry,
} from "../../types";

/** Event payload for a pin state change delivered by the server. */
interface PinDeliverEvent {
  channel_id: number;
  message_id: string;
  pinned: boolean;
  pinner_hash: string;
  pinner_name: string;
  timestamp: number;
}

/** Event payload for a batch of stored pins from the server. */
interface PinFetchResponseEvent {
  channel_id: number;
  pins: {
    message_id: string;
    pinner_hash: string;
    pinner_name: string;
    timestamp: number;
  }[];
}

/** Event payload for a single reaction delivered by the server. */
interface ReactionDeliverEvent {
  channel_id: number;
  message_id: string;
  emoji: string;
  action: string;
  sender_hash: string;
  sender_name: string;
  timestamp: number;
}

/** Event payload for a batch of stored reactions from the server. */
interface ReactionFetchResponseEvent {
  channel_id: number;
  reactions: {
    message_id: string;
    emoji: string;
    sender_hash: string;
    sender_name: string;
    timestamp: number;
  }[];
}

/**
 * Register all persistent-chat event listeners, pushing each unlisten handle
 * onto `unlisteners` (mirrors the inline block previously in
 * `initEventListeners`).
 */
export async function registerPersistentChatEvents(unlisteners: UnlistenFn[]): Promise<void> {
  unlisteners.push(
    // Channel persistence config changed (from ChannelState updates).
    await listen<{ channel_id: number; config: ChannelPersistConfig }>(
      TauriEvent.PersistenceConfigChanged,
      (event) => {
        const { channel_id, config } = event.payload;
        useAppStore.getState().updateChannelPersistenceConfig(channel_id, config);
      },
    ),

    // Key trust level changed for a channel.
    await listen<{ channel_id: number; trust: KeyTrustState }>(
      TauriEvent.KeyTrustChanged,
      (event) => {
        const { channel_id, trust } = event.payload;
        useAppStore.setState((prev) => {
          // Receiving a new key clears the revoked flag for this channel.
          const next = new Set(prev.pchatKeyRevoked);
          next.delete(channel_id);
          return {
            keyTrust: { ...prev.keyTrust, [channel_id]: trust },
            pchatKeyRevoked: next,
          };
        });
      },
    ),

    // Custodian list changed (TOFU change detection).
    await listen<{ channel_id: number; pin: CustodianPinState }>(
      TauriEvent.CustodianPinChanged,
      (event) => {
        const { channel_id, pin } = event.payload;
        useAppStore.setState((prev) => ({
          custodianPins: { ...prev.custodianPins, [channel_id]: pin },
        }));
      },
    ),

    // Key dispute detected.
    await listen<{ channel_id: number; dispute: PendingDispute }>(
      TauriEvent.KeyDisputeDetected,
      (event) => {
        const { channel_id, dispute } = event.payload;
        useAppStore.setState((prev) => ({
          pendingDisputes: { ...prev.pendingDisputes, [channel_id]: dispute },
        }));
      },
    ),

    // Key dispute resolved (by custodian shortcut or timeout).
    await listen<{ channel_id: number }>(
      TauriEvent.KeyDisputeResolved,
      (event) => {
        const { channel_id } = event.payload;
        useAppStore.setState((prev) => {
          const { [channel_id]: _removed, ...rest } = prev.pendingDisputes;
          return { pendingDisputes: rest };
        });
      },
    ),

    // Pchat history loading state (waiting for key exchange).
    await listen<{ channel_id: number; loading: boolean }>(
      TauriEvent.PchatHistoryLoading,
      (event) => {
        const { channel_id, loading } = event.payload;
        const next = new Set(useAppStore.getState().pchatHistoryLoading);
        if (loading) {
          next.add(channel_id);
        } else {
          next.delete(channel_id);
        }
        useAppStore.setState({ pchatHistoryLoading: next });
      },
    ),

    // Pchat fetch complete -- update pagination metadata.
    //
    // Also refresh the displayed `messages` array if the fetched
    // channel happens to be the one the user is currently viewing.
    // The "new-message" listener also tries to do this, but during the
    // initial connect bootstrap the fetch response can arrive *before*
    // selectChannel(defaultCh) has run -- in that case the new-message
    // handler bails (selectedChannel still null) and the restored
    // backlog stays invisible until the user types a message (which
    // forces a get_messages via sendMessage). Refreshing here closes
    // that race for the bootstrap case.
    await listen<{ channel_id: number; has_more: boolean; total_stored: number }>(
      TauriEvent.PchatFetchComplete,
      async (event) => {
        const { channel_id, has_more, total_stored } = event.payload;
        useAppStore.setState((prev) => ({
          channelPersistence: {
            ...prev.channelPersistence,
            [channel_id]: {
              ...prev.channelPersistence[channel_id],
              hasMore: has_more,
              isFetching: false,
              totalStored: total_stored,
            },
          },
        }));
        const { selectedChannel } = useAppStore.getState();
        if (selectedChannel === channel_id) {
          await useAppStore.getState().refreshMessages(channel_id);
        }
      },
    ),

    // A new key-share consent request from the backend.
    await listen<PendingKeyShareRequest>(
      TauriEvent.PchatKeyShareRequest,
      (event) => {
        const req = event.payload;
        useAppStore.setState((prev) => {
          const existing = prev.pendingKeyShares[req.channel_id] ?? [];
          // Avoid duplicates.
          if (existing.some((p) => p.peer_cert_hash === req.peer_cert_hash)) {
            return {};
          }
          return {
            pendingKeyShares: {
              ...prev.pendingKeyShares,
              [req.channel_id]: [...existing, req],
            },
          };
        });
      },
    ),

    // Key-share requests changed (after approve/dismiss).
    await listen<{ channel_id: number; pending: PendingKeyShareRequest[] }>(
      TauriEvent.PchatKeyShareRequestsChanged,
      (event) => {
        const { channel_id, pending } = event.payload;
        useAppStore.setState((prev) => {
          if (pending.length === 0) {
            const { [channel_id]: _removed, ...rest } = prev.pendingKeyShares;
            return { pendingKeyShares: rest };
          }
          return {
            pendingKeyShares: {
              ...prev.pendingKeyShares,
              [channel_id]: pending,
            },
          };
        });
      },
    ),

    // Key holders list updated by the server.
    await listen<{ channel_id: number; holders: KeyHolderEntry[] }>(
      TauriEvent.PchatKeyHoldersChanged,
      (event) => {
        const { channel_id, holders } = event.payload;
        useAppStore.setState((prev) => ({
          keyHolders: {
            ...prev.keyHolders,
            [channel_id]: holders,
          },
        }));
      },
    ),

    // Key restored: a new key was received after a previous revocation.
    await listen<{ channel_id: number }>(
      TauriEvent.PchatKeyRestored,
      (event) => {
        const { channel_id } = event.payload;
        useAppStore.setState((prev) => {
          const next = new Set(prev.pchatKeyRevoked);
          next.delete(channel_id);
          return { pchatKeyRevoked: next };
        });
      },
    ),

    // Key-possession challenge failed: our key was wrong/outdated.
    await listen<{ channel_id: number }>(
      TauriEvent.PchatKeyRevoked,
      (event) => {
        const { channel_id } = event.payload;
        useAppStore.setState((prev) => {
          const next = new Set(prev.pchatKeyRevoked);
          next.add(channel_id);
          // Clear stale key-trust for this channel.
          const { [channel_id]: _removedTrust, ...restTrust } = prev.keyTrust;
          // Clear any messages that were decrypted before the challenge
          // result arrived (prevents flash of unauthorized content).
          const clearMessages = prev.selectedChannel === channel_id;
          // Stop the loading spinner - no fetch response will arrive.
          const nextLoading = new Set(prev.pchatHistoryLoading);
          nextLoading.delete(channel_id);
          const { [channel_id]: prevPersist, ...restPersist } = prev.channelPersistence;
          return {
            pchatKeyRevoked: next,
            keyTrust: restTrust,
            pchatHistoryLoading: nextLoading,
            channelPersistence: {
              ...restPersist,
              [channel_id]: { ...prevPersist, isFetching: false },
            },
            ...(clearMessages ? { messages: [] } : {}),
          };
        });
      },
    ),

    // Reaction add/remove delivered by the server (persistent channels).
    await listen<ReactionDeliverEvent>(
      TauriEvent.PchatReactionDeliver,
      (event) => {
        const { message_id, emoji, action, sender_hash, sender_name } = event.payload;
        const resolvedName = useAppStore.getState().users.find((u) => u.hash === sender_hash)?.name ?? sender_name;
        applyReaction(message_id, emoji, action as "add" | "remove", sender_hash, resolvedName);
        useAppStore.setState((s) => ({ reactionVersion: s.reactionVersion + 1 }));
      },
    ),

    // Batch reaction fetch response (historical reactions for persistent channels).
    await listen<ReactionFetchResponseEvent>(
      TauriEvent.PchatReactionFetchResponse,
      (event) => {
        const { users } = useAppStore.getState();
        for (const r of event.payload.reactions) {
          const resolvedName = users.find((u) => u.hash === r.sender_hash)?.name ?? r.sender_name;
          applyReaction(r.message_id, r.emoji, "add", r.sender_hash, resolvedName);
        }
        useAppStore.setState((s) => ({ reactionVersion: s.reactionVersion + 1 }));
      },
    ),

    // Pin/unpin delivered by the server (persistent channels).
    await listen<PinDeliverEvent>(
      TauriEvent.PchatPinDeliver,
      (event) => {
        const { channel_id, message_id, pinned, pinner_hash, pinner_name, timestamp } = event.payload;
        const resolvedName = useAppStore.getState().users.find((u) => u.hash === pinner_hash)?.name ?? pinner_name;
        useAppStore.setState((s) => {
          const nextUnseen = new Map(s.unseenPinIds);
          const channelSet = new Set(nextUnseen.get(channel_id));
          if (pinned) {
            channelSet.add(message_id);
          } else {
            channelSet.delete(message_id);
          }
          if (channelSet.size > 0) nextUnseen.set(channel_id, channelSet);
          else nextUnseen.delete(channel_id);

          return {
            messages: s.messages.map((m) =>
              m.message_id === message_id
                ? { ...m, pinned, pinned_by: pinned ? resolvedName : null, pinned_at: pinned ? timestamp : null }
                : m,
            ),
            unseenPinIds: nextUnseen,
          };
        });
      },
    ),

    // Batch pin fetch response (historical pins for persistent channels).
    await listen<PinFetchResponseEvent>(
      TauriEvent.PchatPinFetchResponse,
      (event) => {
        const { users } = useAppStore.getState();
        const pinnedIds = new Map(event.payload.pins.map((p) => {
          const resolvedName = users.find((u) => u.hash === p.pinner_hash)?.name ?? p.pinner_name;
          return [p.message_id, { pinned_by: resolvedName, pinned_at: p.timestamp }] as const;
        }));
        useAppStore.setState((s) => ({
          messages: s.messages.map((m) => {
            const pin = m.message_id ? pinnedIds.get(m.message_id) : undefined;
            return pin ? { ...m, pinned: true, pinned_by: pin.pinned_by, pinned_at: pin.pinned_at } : m;
          }),
        }));
      },
    ),

    // Signal bridge load failure: show error banner in the UI.
    await listen<{ message: string }>(
      TauriEvent.PchatSignalBridgeError,
      (event) => {
        useAppStore.setState({ signalBridgeError: event.payload.message });
      },
    ),
  );
}
