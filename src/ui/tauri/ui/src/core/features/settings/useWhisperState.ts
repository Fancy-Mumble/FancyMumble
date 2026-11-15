import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { TauriEvent } from "@core/constants/tauriEvents";
import { WHISPER_UNRESOLVED_EVENT, type WhisperUnresolvedDetail } from "./whisperTargets";

/** How long a transient notice stays up. */
const NOTICE_MS = 4000;

/** One refusal from the server, as `whisper-denials` reports it. */
export interface WhisperRefusal {
  channelId: number;
  reason: string | null;
}

interface WhisperDenialsPayload {
  deniedChannels: number[];
  latest: WhisperRefusal | null;
}

export interface WhisperState {
  /** The whisper key is held and speech is going to its target. */
  active: boolean;
  /** Name of the binding whose last press reached nobody, while the notice is up. */
  unresolved: string | null;
  /** The refusal that just arrived, while the notice is up. */
  refusal: WhisperRefusal | null;
  /** Every channel the server currently refuses whispers into. */
  deniedChannels: number[];
}

/**
 * Whether this client is whispering, and what the server refused, for the
 * chrome that shows it.
 *
 * Asks once on mount as well as listening, because the key is global and the
 * slots are registered in the background: both can happen before the view
 * exists. The calls are guarded - without a Tauri shell under the page they
 * reject, and an indicator is not worth an unhandled rejection.
 */
export function useWhisperState(): WhisperState {
  const [active, setActive] = useState(false);
  const [unresolved, setUnresolved] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<WhisperRefusal | null>(null);
  const [deniedChannels, setDeniedChannels] = useState<number[]>([]);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    invoke<boolean>("get_whisper_active")
      .then((value) => alive && setActive(Boolean(value)))
      .catch(() => undefined);
    invoke<number[]>("get_whisper_denials")
      .then((value) => alive && Array.isArray(value) && setDeniedChannels(value))
      .catch(() => undefined);
    const stopState = listen<boolean>(TauriEvent.WhisperState, (event) => {
      setActive(Boolean(event.payload));
      if (event.payload) setUnresolved(null);
    }).catch(() => null);
    const stopDenials = listen<WhisperDenialsPayload>(TauriEvent.WhisperDenials, (event) => {
      setDeniedChannels(event.payload.deniedChannels ?? []);
      const latest = event.payload.latest;
      if (!latest) return;
      setRefusal(latest);
      clearTimeout(timer);
      timer = setTimeout(() => setRefusal(null), NOTICE_MS);
    }).catch(() => null);
    return () => {
      alive = false;
      clearTimeout(timer);
      void stopState.then((stop) => stop?.());
      void stopDenials.then((stop) => stop?.());
    };
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onUnresolved = (event: Event) => {
      const detail = (event as CustomEvent<WhisperUnresolvedDetail>).detail;
      setUnresolved(detail?.name ?? "");
      clearTimeout(timer);
      timer = setTimeout(() => setUnresolved(null), NOTICE_MS);
    };
    globalThis.addEventListener(WHISPER_UNRESOLVED_EVENT, onUnresolved);
    return () => {
      clearTimeout(timer);
      globalThis.removeEventListener(WHISPER_UNRESOLVED_EVENT, onUnresolved);
    };
  }, []);

  return { active, unresolved, refusal, deniedChannels };
}
