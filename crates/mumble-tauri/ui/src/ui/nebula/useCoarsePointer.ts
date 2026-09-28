/**
 * Whether the primary pointer is a finger - the hook form of `TOUCH`.
 *
 * For the sizes that are props rather than styles (an avatar's pixel size, an
 * icon's), which a media query in `sx` cannot reach.
 */
import { useSyncExternalStore } from "react";

const QUERY = "(pointer: coarse)";

function subscribe(onChange: () => void): () => void {
  const media = globalThis.matchMedia?.(QUERY);
  if (!media) return () => undefined;
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function snapshot(): boolean {
  return globalThis.matchMedia?.(QUERY).matches ?? false;
}

export function useCoarsePointer(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
