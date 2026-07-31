import { useCallback, useEffect, useRef } from "react";
import { findSoundUrl } from "@core/features/notifications/sounds";

/**
 * Plays a one-off preview of a notification sound.
 *
 * Only one preview is audible at a time - clicking down a list of events
 * otherwise stacks overlapping clips - and the last one is stopped on unmount
 * so closing settings mid-preview goes quiet.
 */
export function useSoundPreview(): (sound: string, volume: number) => void {
  const playing = useRef<HTMLAudioElement | null>(null);

  useEffect(
    () => () => {
      playing.current?.pause();
      playing.current = null;
    },
    [],
  );

  return useCallback((sound: string, volume: number) => {
    const url = findSoundUrl(sound);
    if (!url) return;
    playing.current?.pause();
    const audio = new Audio(url);
    audio.volume = volume;
    playing.current = audio;
    audio.play().catch(() => undefined);
  }, []);
}
