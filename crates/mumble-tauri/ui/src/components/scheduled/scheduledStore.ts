/**
 * Scheduled-messages feature store + helpers.
 *
 * Backed by the server-side scheduler (`schedule_message` /
 * `list_scheduled_messages` / `cancel_scheduled_message` Tauri commands).
 * All scheduling logic lives in the Rust backend - this store only invokes
 * commands and reacts to the `fancy-scheduled-message-list` /
 * `fancy-scheduled-message-ack` events, which the main app store
 * (`src/store.ts`) wires into the setters below.
 */

import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

// -- Wire types ----------------------------------------------------

/** Delivery status of a scheduled message. */
export enum ScheduleStatus {
  Pending = 0,
  Delivered = 1,
  Cancelled = 2,
  Rejected = 3,
}

/** A scheduled message as delivered by the backend. */
export interface ScheduledMessage {
  scheduleId: string;
  channelIds: number[];
  treeIds: number[];
  message?: string;
  /** Delivery time, Unix epoch milliseconds. */
  deliverAt?: number;
  creatorSession?: number;
  creatorHash?: string;
  creatorName?: string;
  /** Creation time, Unix epoch milliseconds. */
  createdAt?: number;
  status: number;
}

/** Payload of the `fancy-scheduled-message-ack` event. */
export interface ScheduledAck {
  scheduleId?: string;
  status: number;
  reason?: string;
}

// -- Store ---------------------------------------------------------

interface ScheduledStoreState {
  /** The user's scheduled messages, as last reported by the backend. */
  messages: ScheduledMessage[];
  /** Most recent ack from the backend (for surfacing accept / reject to the UI). */
  lastAck: ScheduledAck | null;
  /** True while a `list_scheduled_messages` request is in flight. */
  loading: boolean;

  setMessages: (messages: ScheduledMessage[]) => void;
  setLastAck: (ack: ScheduledAck | null) => void;

  scheduleMessage: (
    channelIds: number[],
    message: string,
    deliverAtMs: number,
    treeIds?: number[],
  ) => Promise<void>;
  listScheduledMessages: () => Promise<void>;
  cancelScheduledMessage: (scheduleId: string) => Promise<void>;

  /** Reset all scheduled-message state (called on disconnect / server switch). */
  clearScheduled: () => void;
}

export const useScheduledStore = create<ScheduledStoreState>((set) => ({
  messages: [],
  lastAck: null,
  loading: false,

  setMessages: (messages) => set({ messages, loading: false }),
  setLastAck: (lastAck) => set({ lastAck }),

  scheduleMessage: async (channelIds, message, deliverAtMs, treeIds) => {
    await invoke("schedule_message", {
      channelIds,
      treeIds: treeIds ?? [],
      message,
      deliverAt: deliverAtMs,
    });
  },

  listScheduledMessages: async () => {
    set({ loading: true });
    try {
      await invoke("list_scheduled_messages", {});
    } catch (e) {
      set({ loading: false });
      console.error("[scheduled] listScheduledMessages failed:", e);
    }
  },

  cancelScheduledMessage: async (scheduleId) => {
    await invoke("cancel_scheduled_message", { scheduleId });
  },

  clearScheduled: () => set({ messages: [], lastAck: null, loading: false }),
}));
