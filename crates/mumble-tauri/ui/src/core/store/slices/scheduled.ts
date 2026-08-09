/**
 * Scheduled-messages slice: the caller's own pending scheduled messages for
 * the current connection.
 *
 * Backed by the server-side scheduler (`schedule_message` /
 * `list_scheduled_messages` / `cancel_scheduled_message` Tauri commands). All
 * scheduling logic lives in the Rust backend - this slice only invokes
 * commands and reacts to the `fancy-scheduled-message-list` /
 * `fancy-scheduled-message-ack` events (wired in `scheduled.events.ts`).
 *
 * Part of the root `INITIAL`, like `DownloadsSlice`: a scheduled message is
 * scoped to the server connection that made it, so a disconnect must clear it
 * the same way the rest of `INITIAL` does.
 */

import { invoke } from "@tauri-apps/api/core";
import type { StateCreator } from "zustand";
import type { AppState } from "..";

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

export interface ScheduledSlice {
  /** The user's scheduled messages, as last reported by the backend. */
  scheduledMessages: ScheduledMessage[];
  /** Most recent ack from the backend (surfaces accept / reject to the UI). */
  scheduledLastAck: ScheduledAck | null;
  /** True while a `list_scheduled_messages` request is in flight. */
  scheduledLoading: boolean;

  applyScheduledMessageList: (messages: ScheduledMessage[]) => void;
  applyScheduledMessageAck: (ack: ScheduledAck | null) => void;

  scheduleMessage: (
    channelIds: number[],
    message: string,
    deliverAtMs: number,
    treeIds?: number[],
  ) => Promise<void>;
  listScheduledMessages: () => Promise<void>;
  cancelScheduledMessage: (scheduleId: string) => Promise<void>;
}

/** State-only portion of {@link ScheduledSlice}. */
type ScheduledState = Pick<
  ScheduledSlice,
  "scheduledMessages" | "scheduledLastAck" | "scheduledLoading"
>;

/** Default scheduled-message state (also spread into the root `INITIAL`). */
export const scheduledInitialState: ScheduledState = {
  scheduledMessages: [],
  scheduledLastAck: null,
  scheduledLoading: false,
};

export const createScheduledSlice: StateCreator<AppState, [], [], ScheduledSlice> = (set) => ({
  ...scheduledInitialState,

  applyScheduledMessageList: (messages) => {
    set({ scheduledMessages: messages, scheduledLoading: false });
  },

  applyScheduledMessageAck: (ack) => {
    set({ scheduledLastAck: ack });
  },

  scheduleMessage: async (channelIds, message, deliverAtMs, treeIds) => {
    await invoke("schedule_message", {
      channelIds,
      treeIds: treeIds ?? [],
      message,
      deliverAt: deliverAtMs,
    });
  },

  listScheduledMessages: async () => {
    set({ scheduledLoading: true });
    try {
      await invoke("list_scheduled_messages", {});
    } catch (e) {
      set({ scheduledLoading: false });
      console.error("[scheduled] listScheduledMessages failed:", e);
    }
  },

  cancelScheduledMessage: async (scheduleId) => {
    await invoke("cancel_scheduled_message", { scheduleId });
  },
});
