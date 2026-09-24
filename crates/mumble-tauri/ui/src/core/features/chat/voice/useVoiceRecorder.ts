/**
 * The composer's half of voice messages: whether the microphone button shows,
 * and what happens between pressing it and the note arriving in the channel.
 *
 * The recording itself is native (see `state/voice_message` in the backend);
 * this hook starts it, follows its `voice-message-state` events, and on send
 * collects the clip and hands it to {@link sendVoiceMessage}.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useAppStore } from "@core/store";
import { PERM_SEND_VOICE_MESSAGE } from "@core/utils/permissions";
import { discardVoiceClip, sendVoiceMessage, type RecordedVoiceClip } from "./sendVoiceMessage";
import { useVoiceSupport } from "./voiceSupport";

/** Live bars the recording strip draws. */
export const LIVE_BARS = 32;

export type VoiceRecorderState =
  | { readonly phase: "idle" }
  | { readonly phase: "starting" }
  | {
      readonly phase: "recording";
      readonly elapsedMs: number;
      /** The most recent input levels, 0 to 1, oldest first. */
      readonly levels: readonly number[];
      /** The take stopped itself at the server's ceiling and waits to be sent. */
      readonly limitReached: boolean;
    }
  | { readonly phase: "sending" };

type RecorderEvent =
  | { readonly state: "recording"; readonly elapsedMs: number; readonly level: number }
  | { readonly state: "limit"; readonly elapsedMs: number }
  | { readonly state: "failed"; readonly reason: string };

export interface VoiceRecorder {
  /** Whether this server and channel take voice messages at all. */
  readonly available: boolean;
  /** The server's ceiling in milliseconds, 0 for none. */
  readonly limitMs: number;
  readonly state: VoiceRecorderState;
  /** The last thing that went wrong, in words, until cleared or retried. */
  readonly error: string | null;
  readonly start: () => Promise<void>;
  readonly send: () => Promise<void>;
  readonly cancel: () => void;
  readonly clearError: () => void;
}

const IDLE: VoiceRecorderState = { phase: "idle" };

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * @param channelId the channel the note goes to, or routes through for a DM.
 * @param dmSession set when the note is a DM to that session.
 */
export function useVoiceRecorder(channelId: number | null, dmSession: number | null): VoiceRecorder {
  const serverId = useAppStore((state) => state.activeServerId);
  const support = useVoiceSupport(serverId);
  const permissions = useAppStore((state) =>
    channelId === null
      ? null
      : (state.channels.find((channel) => channel.id === channelId)?.permissions ?? null),
  );
  // Unknown permissions show the button: the server checks the bit anyway, and
  // hiding it until a permission query comes back would make it flicker in.
  const permitted = permissions === null || (permissions & PERM_SEND_VOICE_MESSAGE) !== 0;
  const available = !!support?.available && channelId !== null && permitted;
  const limitMs = support?.maxSeconds ? support.maxSeconds * 1000 : 0;
  const maxBytes = support?.maxBytes ?? 0;

  const [state, setState] = useState<VoiceRecorderState>(IDLE);
  const [error, setError] = useState<string | null>(null);
  const unlisten = useRef<UnlistenFn | null>(null);
  const active = useRef(false);
  const target = useRef({ channelId, dmSession });
  target.current = { channelId, dmSession };

  const stopListening = useCallback(() => {
    unlisten.current?.();
    unlisten.current = null;
  }, []);

  // A composer that goes away mid-take must not leave the microphone open.
  useEffect(
    () => () => {
      stopListening();
      if (active.current) void invoke("cancel_voice_message").catch(() => {});
    },
    [stopListening],
  );

  const start = useCallback(async () => {
    if (!available || active.current) return;
    active.current = true;
    setError(null);
    setState({ phase: "starting" });
    const levels: number[] = [];
    try {
      stopListening();
      unlisten.current = await listen<RecorderEvent>("voice-message-state", (event) => {
        const payload = event.payload;
        if (payload.state === "failed") {
          stopListening();
          active.current = false;
          setError(payload.reason);
          setState(IDLE);
          return;
        }
        if (payload.state === "recording") {
          levels.push(payload.level);
          if (levels.length > LIVE_BARS) levels.shift();
        }
        setState({
          phase: "recording",
          elapsedMs: payload.elapsedMs,
          levels: [...levels],
          limitReached: payload.state === "limit",
        });
      });
      await invoke("start_voice_message", { limitMs });
      setState((current) =>
        current.phase === "starting"
          ? { phase: "recording", elapsedMs: 0, levels: [], limitReached: false }
          : current,
      );
    } catch (e) {
      stopListening();
      active.current = false;
      setError(message(e));
      setState(IDLE);
    }
  }, [available, limitMs, stopListening]);

  const cancel = useCallback(() => {
    stopListening();
    if (active.current) void invoke("cancel_voice_message").catch(() => {});
    active.current = false;
    setState(IDLE);
  }, [stopListening]);

  const send = useCallback(async () => {
    if (!active.current) return;
    stopListening();
    setState({ phase: "sending" });
    let clip: RecordedVoiceClip | null = null;
    try {
      clip = await invoke<RecordedVoiceClip>("finish_voice_message");
      const { channelId: channel, dmSession: dm } = target.current;
      if (channel === null) throw new Error("no channel to send the voice message to");
      // Said here rather than after a refused upload: the size is known, and
      // uploading two megabytes to be told no is the slow way to learn it.
      if (maxBytes > 0 && clip.size > maxBytes) {
        await discardVoiceClip(clip);
        throw new Error("the voice message is larger than this server allows");
      }
      await sendVoiceMessage(clip, { channelId: channel, dmSession: dm });
    } catch (e) {
      setError(message(e));
    } finally {
      active.current = false;
      setState(IDLE);
    }
  }, [maxBytes, stopListening]);

  const clearError = useCallback(() => setError(null), []);

  return { available, limitMs, state, error, start, send, cancel, clearError };
}

/** `m:ss`, for elapsed time and clip length. */
export function formatClipTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
