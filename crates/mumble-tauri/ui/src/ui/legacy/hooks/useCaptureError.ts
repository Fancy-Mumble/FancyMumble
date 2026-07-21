import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

/**
 * Latest microphone capture-start result from the backend.
 *
 * Emitted whenever a capture pipeline (voice, mic test, voice replay)
 * tries to open the microphone. A `null` payload means the microphone
 * opened successfully and any previous error should be cleared.
 */
export interface CaptureError {
  /** `"device_busy"` when the device is held by another app, else `"other"`. */
  kind: string;
  /** Raw backend error message (shown for non-busy failures). */
  message: string;
  /** Other apps currently holding the microphone (process names, best-effort). */
  holders?: string[];
}

/**
 * Subscribe to the backend `capture-error` event and expose the current
 * capture error (or `null` when the mic is working). Multiple components
 * may call this independently; Tauri broadcasts the event to each.
 */
export function useCaptureError(): CaptureError | null {
  const [error, setError] = useState<CaptureError | null>(null);
  useEffect(() => {
    let active = true;
    // Query the current state on mount so a view that appeared AFTER the
    // event fired (e.g. the sidebar after leaving the settings route) still
    // reflects a busy microphone. Then listen for live updates.
    invoke<CaptureError | null>("get_capture_state")
      .then((s) => {
        if (active) setError(s ?? null);
      })
      .catch(() => { /* command unavailable (non-desktop) */ });
    const unlisten = listen<CaptureError | null>("capture-error", (event) => {
      setError(event.payload ?? null);
    });
    return () => {
      active = false;
      unlisten.then((f) => f());
    };
  }, []);
  return error;
}

/** Human-readable list of the apps holding the mic, or `null` if unknown. */
export function captureHolders(error: CaptureError | null): string | null {
  const holders = error?.holders?.filter(Boolean) ?? [];
  return holders.length > 0 ? holders.join(", ") : null;
}
