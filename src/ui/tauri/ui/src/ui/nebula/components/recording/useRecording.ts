/**
 * The backend's audio recorder, as the dock and its dialog see it.
 *
 * The backend records inbound voice to a file; all the UI holds is whether it
 * is running, where to, and for how long. It is asked once when the feature
 * becomes available, so a recording started before a reload is still shown,
 * and polled only while one is running.
 */
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface RecordingState {
  is_recording: boolean;
  file_path: string | null;
  elapsed_secs: number;
}

export interface RecordingTarget {
  directory: string;
  filename: string;
}

const IDLE: RecordingState = { is_recording: false, file_path: null, elapsed_secs: 0 };
/** Standard's refresh rate for the elapsed clock. */
const POLL_MS = 500;
const TARGET_KEY = "nebula.recording.target";
/** Standard's default template. */
export const DEFAULT_FILENAME = "recording_{datetime}_{channel}";

/** `mm:ss`, or `hh:mm:ss` past the hour. */
export function formatElapsed(secs: number): string {
  const whole = Math.max(0, Math.floor(secs));
  const pad = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/**
 * Where the last recording went. Remembered on this device only: a folder is a
 * path on this machine, and asking for it again every time is what made
 * Standard's dialog a chore to reopen.
 */
export function loadTarget(): RecordingTarget {
  try {
    const stored = JSON.parse(localStorage.getItem(TARGET_KEY) ?? "null") as Partial<RecordingTarget> | null;
    return {
      directory: typeof stored?.directory === "string" ? stored.directory : "",
      filename: typeof stored?.filename === "string" && stored.filename ? stored.filename : DEFAULT_FILENAME,
    };
  } catch {
    return { directory: "", filename: DEFAULT_FILENAME };
  }
}

export function saveTarget(target: RecordingTarget): void {
  try {
    localStorage.setItem(TARGET_KEY, JSON.stringify(target));
  } catch {
    // Storage refused: the next open asks for the folder again, nothing worse.
  }
}

export function useRecording(enabled: boolean) {
  const [state, setState] = useState<RecordingState>(IDLE);

  const refresh = useCallback(async () => {
    const next = await invoke<RecordingState>("get_recording_state").catch(() => null);
    if (next) setState(next);
  }, []);

  useEffect(() => {
    if (enabled) void refresh();
  }, [enabled, refresh]);

  useEffect(() => {
    if (!state.is_recording) return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [state.is_recording, refresh]);

  const start = useCallback(async (target: RecordingTarget) => {
    const path = await invoke<string>("start_recording", { ...target, format: "wav" });
    setState({ is_recording: true, file_path: path, elapsed_secs: 0 });
  }, []);

  const stop = useCallback(async () => {
    await invoke<string>("stop_recording");
    setState((prev) => ({ ...prev, is_recording: false }));
  }, []);

  return { state, start, stop };
}

export type RecordingControls = ReturnType<typeof useRecording>;
