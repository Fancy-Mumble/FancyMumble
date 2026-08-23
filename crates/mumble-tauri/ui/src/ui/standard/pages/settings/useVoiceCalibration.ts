/**
 * Everything calibrating the voice gate does, minus how it looks.
 *
 * Two designs draw this: Standard's `CalibrationPanel` and Nebula's
 * `VoiceGate`. What they share is not a widget - the mocks disagree about every
 * box on screen - but the conversation with the backend: start and stop the mic
 * test, follow `mic-amplitude` at frame rate without re-rendering on each one,
 * measure how long the user has actually been speaking, take the calibrator's
 * answer and remember what it was calibrated *for*, and run the replay recorder.
 * That is what lives here, so a fix to any of it fixes both designs.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getPreferences, updatePreferences } from "@core/preferencesStorage";
import type { AudioSettings } from "@core/types";

/** How long the user has to keep talking for an auto calibration to be sure. */
export const SPEECH_TARGET_MS = 5000;

/** The replay recorder's buffer. */
export const REPLAY_CAPACITY_MS = 20_000;

/** How long "speaking" stays lit after the level drops, so it does not flicker. */
const SPEAKING_HOLD_MS = 700;

export type ReplayPhase =
  | { phase: "idle" }
  | { phase: "recording"; elapsed_ms: number; capacity_ms: number }
  | { phase: "playing"; elapsed_ms: number; total_ms: number };

/**
 * Fingerprint of the audio settings that a voice-activation calibration
 * depends on.  Persisted in the preferences store (`preferences.json`,
 * via `calibrationSignature`) so it survives window reopen and app
 * restart.  The "calibration needed" hint reappears only when this
 * fingerprint is missing (never calibrated) or differs from the current
 * one (a relevant input setting changed) - NOT merely because the
 * window was reopened.
 *
 * Only input-chain settings that change what the calibrator measures
 * are included.  The values calibration itself produces
 * (`vad_threshold`, `noise_gate_close_ratio`, `hold_frames`,
 * `max_gain_db`) are deliberately excluded so a completed calibration
 * does not invalidate itself, and the playback / encoding / PTT
 * settings are excluded because they do not affect mic calibration.
 */
function calibrationSignature(s: AudioSettings): string {
  return JSON.stringify({
    device: s.selected_device,
    autoGain: s.auto_gain,
    noiseSuppression: s.noise_suppression,
    denoiser: s.denoiser_algorithm,
  });
}

/**
 * Returns the minimum RMS that counts as "speaking" for the speech-progress
 * bar: 70% of the current gate threshold, with a hard floor so near-zero
 * thresholds don't let background noise advance the bar.
 */
export function speechThreshold(vadThreshold: number): number {
  return Math.max(vadThreshold * 0.7, 0.005);
}

/** How full the replay button's fill bar should be, 0-1. */
export function replayProgress(phase: ReplayPhase): number {
  switch (phase.phase) {
    case "recording":
      return phase.capacity_ms > 0 ? phase.elapsed_ms / phase.capacity_ms : 0;
    case "playing":
      return (phase.total_ms - phase.elapsed_ms) / REPLAY_CAPACITY_MS;
    default:
      return 0;
  }
}

export interface VoiceCalibration {
  /** True while the microphone test is running and levels are arriving. */
  testing: boolean;
  toggleTest: () => void;
  /** Current level, updated at frame rate. */
  rms: number;
  peak: number;
  /** True when the level would open the gate right now. */
  talking: boolean;
  /** `talking` with a hold, for a label that would otherwise strobe. */
  speaking: boolean;
  /** How much of the five seconds of speech the calibrator wants is done, 0-1. */
  speechProgress: number;
  /** False when this input chain has never been calibrated, or has changed. */
  hasCalibrated: boolean;
  replay: ReplayPhase;
  toggleReplay: () => void;
}

export function useVoiceCalibration(
  settings: AudioSettings,
  onChange: (patch: Partial<AudioSettings>) => void,
): VoiceCalibration {
  const [testing, setTesting] = useState(false);
  const testingRef = useRef(false);
  // Levels arrive far faster than React should re-render, so they are held in a
  // ref and published once per animation frame.
  const amplitudeRef = useRef({ rms: 0, peak: 0 });
  const [ampTick, setAmpTick] = useState(0);
  const rafHandle = useRef(0);
  const [replay, setReplay] = useState<ReplayPhase>({ phase: "idle" });

  // Keep the latest settings reachable from the calibration event
  // listener without re-subscribing on every settings change.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // `undefined` until the persisted signature is read from the
  // preferences store; `null` once read with no prior calibration.
  const [calibratedSig, setCalibratedSig] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    getPreferences()
      .then((p) => {
        if (active) setCalibratedSig(p.calibrationSignature ?? null);
      })
      .catch(() => {
        if (active) setCalibratedSig(null);
      });
    return () => {
      active = false;
    };
  }, []);

  // Derived so a relevant settings change or a fresh calibration is
  // reflected immediately. While the signature is still loading
  // (`undefined`), assume calibrated so the hint does not flash before
  // the persisted value arrives.
  const hasCalibrated =
    calibratedSig === undefined ||
    (calibratedSig !== null && calibratedSig === calibrationSignature(settings));

  const speechMsRef = useRef(0);
  const lastAmplitudeEventTime = useRef<number | null>(null);
  const speechThresholdRef = useRef(speechThreshold(settings.vad_threshold));
  speechThresholdRef.current = speechThreshold(settings.vad_threshold);

  const toggleTest = useCallback(() => {
    void (async () => {
      if (testingRef.current) {
        await invoke("stop_mic_test").catch(() => {});
        setTesting(false);
        testingRef.current = false;
        amplitudeRef.current = { rms: 0, peak: 0 };
        setAmpTick((tick) => tick + 1);
      } else {
        try {
          await invoke("start_mic_test");
          setTesting(true);
          testingRef.current = true;
        } catch (e) {
          console.error("Mic test failed:", e);
        }
      }
    })();
  }, []);

  useEffect(() => {
    speechMsRef.current = 0;
    lastAmplitudeEventTime.current = null;
    if (!testing) return;
    const unlisten = listen<{ rms: number; peak: number }>("mic-amplitude", (event) => {
      const now = performance.now();
      const prev = lastAmplitudeEventTime.current;
      lastAmplitudeEventTime.current = now;
      if (prev !== null && event.payload.rms > speechThresholdRef.current) {
        speechMsRef.current = Math.min(speechMsRef.current + (now - prev), SPEECH_TARGET_MS);
      }
      amplitudeRef.current = event.payload;
      cancelAnimationFrame(rafHandle.current);
      rafHandle.current = requestAnimationFrame(() => setAmpTick((tick) => tick + 1));
    });
    return () => {
      cancelAnimationFrame(rafHandle.current);
      unlisten.then((f) => f());
    };
  }, [testing]);

  useEffect(() => {
    return () => {
      if (testingRef.current) {
        invoke("stop_mic_test").catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    const unlisten = listen<{
      vad_threshold: number;
      noise_gate_close_ratio: number;
      hold_frames: number;
      max_gain_db: number;
    }>("voice-activation-calibrated", (event) => {
      onChange({
        vad_threshold: event.payload.vad_threshold,
        noise_gate_close_ratio: event.payload.noise_gate_close_ratio,
        hold_frames: event.payload.hold_frames,
        max_gain_db: event.payload.max_gain_db,
      });
      // Record the fingerprint of the settings this calibration was done
      // under, so the hint stays hidden until a relevant setting changes.
      const sig = calibrationSignature(settingsRef.current);
      setCalibratedSig(sig);
      void updatePreferences({ calibrationSignature: sig });
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, [onChange]);

  useEffect(() => {
    const unlisten = listen<ReplayPhase>("voice-replay-state", (event) => setReplay(event.payload));
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  useEffect(() => {
    return () => {
      invoke("stop_voice_replay").catch(() => {});
    };
  }, []);

  const toggleReplay = useCallback(() => {
    void invoke(replay.phase === "idle" ? "start_voice_replay" : "stop_voice_replay").catch((e) =>
      console.error("Voice replay failed:", e),
    );
  }, [replay.phase]);

  void ampTick;
  const { rms, peak } = amplitudeRef.current;
  const talking = rms > settings.vad_threshold;
  const speaking = useHeldFlag(rms > speechThresholdRef.current);

  return {
    testing,
    toggleTest,
    rms,
    peak,
    talking,
    speaking,
    speechProgress: Math.min(speechMsRef.current / SPEECH_TARGET_MS, 1),
    hasCalibrated,
    replay,
    toggleReplay,
  };
}

/** `flag`, but it stays true for a moment after it drops. */
function useHeldFlag(flag: boolean): boolean {
  const [held, setHeld] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (flag) {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      setHeld(true);
    } else {
      timer.current = setTimeout(() => {
        timer.current = null;
        setHeld(false);
      }, SPEAKING_HOLD_MS);
    }
    return () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, [flag]);

  return held;
}
