/**
 * What each connected server allows of voice messages.
 *
 * Asked once per connection (`request_voice_support`), and pushed again by the
 * server whenever its operator changes a voice-message setting, so a composer
 * already on screen gains or loses its microphone without a reconnect. A
 * server that predates voice messages never answers, and no answer is "off".
 *
 * Kept per server rather than as one "current" answer: a push can arrive from
 * a server in a background tab, and it must not change what the active tab's
 * composer offers.
 */

import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface VoiceSupport {
  /** The server's `allow_voice_messages`. */
  readonly available: boolean;
  /** Longest clip in seconds, 0 for no limit. */
  readonly maxSeconds: number;
  /** Largest clip in bytes, 0 for no limit. */
  readonly maxBytes: number;
}

interface VoiceSupportPayload {
  readonly requestId: string;
  readonly available: boolean;
  readonly maxSeconds: number;
  readonly maxBytes: number;
  /** Stamped by the backend with the server the answer came from. */
  readonly serverId?: string | null;
}

/** Answers by server id. `""` holds one whose server was not stamped. */
const byServer = new Map<string, VoiceSupport>();
const listeners = new Set<() => void>();
let listening: Promise<UnlistenFn> | null = null;
let counter = 0;

function notify(): void {
  for (const listener of listeners) listener();
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function attach(): Promise<UnlistenFn> {
  listening ??= listen<VoiceSupportPayload>("voice-support", (event) => {
    const payload = event.payload;
    byServer.set(payload.serverId ?? "", {
      available: payload.available === true,
      maxSeconds: count(payload.maxSeconds),
      maxBytes: count(payload.maxBytes),
    });
    notify();
  });
  return listening;
}

/** Ask the active server; its answer (or its silence) lands in the map. */
export async function askServerVoiceSupport(): Promise<void> {
  await attach();
  counter += 1;
  await invoke("request_voice_support", {
    requestId: `voice-support-${Date.now().toString(36)}-${counter}`,
  }).catch(() => {
    // Not connected: there is nothing to know yet.
  });
}

/** Forget a server's answer, for when it disconnects. */
export function forgetServerVoiceSupport(serverId: string | null | undefined): void {
  if (byServer.delete(serverId ?? "")) notify();
}

/** What `serverId` allows, or `null` when it has not said (read: off). */
export function voiceSupportFor(serverId: string | null | undefined): VoiceSupport | null {
  return byServer.get(serverId ?? "") ?? null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** {@link voiceSupportFor}, following pushes. */
export function useVoiceSupport(serverId: string | null | undefined): VoiceSupport | null {
  const read = () => voiceSupportFor(serverId);
  return useSyncExternalStore(subscribe, read, read);
}

/** For tests: drop every answer and the listener. */
export function resetVoiceSupportForTests(): void {
  byServer.clear();
  listening = null;
  notify();
}
