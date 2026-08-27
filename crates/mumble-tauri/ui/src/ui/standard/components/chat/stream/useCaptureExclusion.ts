/**
 * The "hide this app from screen capture" switch of the own broadcast.
 *
 * While a SCREEN share runs the backend applies capture exclusion to our
 * windows (`WDA_EXCLUDEFROMCAPTURE` / macOS sharing type none) so the live
 * self-preview cannot feed back into the captured screen. The side effect
 * surprises people: an excluded window is invisible to *every* capture API,
 * so the Snipping Tool, OBS and any other recorder see nothing where the
 * client is - you cannot screenshot your own client while sharing.
 *
 * This hook exposes the backend's process-wide preference so the user can
 * lift the exclusion for the running share. It is not persisted: the
 * feedback loop it guards against is real, so a restart starts safe again.
 */
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface CaptureExclusion {
  /** True while our windows hide from capture (the default). */
  readonly hidden: boolean;
  readonly setHidden: (hidden: boolean) => void;
}

export function useCaptureExclusion(): CaptureExclusion {
  const [hidden, setHiddenState] = useState(true);

  // The preference lives in the backend, so a remounted menu shows what is
  // actually applied rather than the default.
  useEffect(() => {
    let cancelled = false;
    // `invoke` throws synchronously without a Tauri host (component
    // previews, the browser dev server), which an effect must not do.
    void (async () => {
      try {
        const value = await invoke<boolean>("self_capture_exclusion");
        if (!cancelled) setHiddenState(value);
      } catch (e) {
        console.warn("[screenshare] reading capture exclusion failed:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setHidden = useCallback((next: boolean) => {
    setHiddenState(next);
    void (async () => {
      try {
        await invoke("set_self_capture_exclusion", { hidden: next });
      } catch (e) {
        console.error("[screenshare] capture exclusion toggle failed:", e);
        setHiddenState(!next);
      }
    })();
  }, []);

  return { hidden, setHidden };
}
