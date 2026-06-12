import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AudioSettings } from "../../types";
import { getPreferences, updatePreferences } from "../../preferencesStorage";
import { SparklesIcon, SlidersIcon } from "../../icons";
import { SliderField } from "./SharedControls";
import { VuMeter, type VuMarker } from "./VuMeter";
import { RadioCardGroup, type RadioCardOption } from "../../components/elements/RadioCardGroup";
import styles from "./SettingsPage.module.css";
import panelStyles from "./CalibrationPanel.module.css";

type TFn = (key: string, opts?: Record<string, unknown>) => string;

type CalibrationMode = "auto" | "manual";

type ModeOption = RadioCardOption<CalibrationMode>;

type ReplayPhase =
  | { phase: "idle" }
  | { phase: "recording"; elapsed_ms: number; capacity_ms: number }
  | { phase: "playing"; elapsed_ms: number; total_ms: number };

const SPEECH_TARGET_MS = 5000;
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
function speechThreshold(vadThreshold: number): number {
  return Math.max(vadThreshold * 0.7, 0.005);
}

function buildModeOptions(t: TFn): ModeOption[] {
  return [
    {
      value: "auto",
      label: t("calibration.autoMode"),
      description: t("calibration.autoModeDesc"),
      Icon: SparklesIcon,
    },
    {
      value: "manual",
      label: t("calibration.manualMode"),
      description: t("calibration.manualModeDesc"),
      Icon: SlidersIcon,
    },
  ];
}

function CalibrationModeSelector({
  mode,
  onChange,
  t,
}: Readonly<{ mode: CalibrationMode; onChange: (mode: CalibrationMode) => void; t: TFn }>) {
  return (
    <RadioCardGroup
      name="calibration_mode"
      options={buildModeOptions(t)}
      value={mode}
      onChange={onChange}
    />
  );
}

function AutoCalibrationView({
  settings,
  rms,
  peak,
  testing,
  onToggleTest,
  hasCalibrated,
  speechProgress,
  t,
}: Readonly<{
  settings: AudioSettings;
  rms: number;
  peak: number;
  testing: boolean;
  onToggleTest: () => void;
  hasCalibrated: boolean;
  speechProgress: number;
  t: TFn;
}>) {
  const isSpeaking = rms > speechThreshold(settings.vad_threshold);

  const [isSpeakingDisplay, setIsSpeakingDisplay] = useState(false);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isSpeaking) {
      if (holdTimerRef.current !== null) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
      setIsSpeakingDisplay(true);
    } else {
      holdTimerRef.current = setTimeout(() => {
        holdTimerRef.current = null;
        setIsSpeakingDisplay(false);
      }, 700);
    }
    return () => {
      if (holdTimerRef.current !== null) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
    };
  }, [isSpeaking]);

  return (
    <div className={panelStyles.calibrationView}>
      {!hasCalibrated && !testing && (
        <div className={styles.warningBanner}>
          <span>{t("calibration.needsCalibration")}</span>
          <p>{t("calibration.needsCalibrationPara")}</p>
        </div>
      )}
      <div className={panelStyles.calibrateActionRow}>
        <div className={panelStyles.calibrationReadouts}>
          <span>
            {t("calibration.threshold")} <strong>{(settings.vad_threshold * 100).toFixed(1)}%</strong>
          </span>
          <span>
            {t("calibration.close")} <strong>{(settings.noise_gate_close_ratio * 100).toFixed(0)}%</strong>
          </span>
          <span>
            {t("calibration.hold")} <strong>{settings.hold_frames} {t("calibration.frames")}</strong>
          </span>
          <span>
            {t("calibration.maxGain")} <strong>{settings.max_gain_db.toFixed(1)} dB</strong>
          </span>
        </div>
        <button
          type="button"
          className={`${panelStyles.calibrateBtn} ${testing ? panelStyles.micTestActive : panelStyles.calibrateBtnPrimary} ${!hasCalibrated && !testing ? panelStyles.calibrateBtnPulse : ""}`}
          onClick={onToggleTest}
        >
          {testing ? t("calibration.stop") : t("calibration.calibrate")}
        </button>
      </div>
      {testing && (
        <div className={panelStyles.speechProgressBar}>
          <div
            className={panelStyles.speechProgressFill}
            style={{ width: `${speechProgress * 100}%` }}
          />
          <span className={panelStyles.speechProgressStatus}>
            {speechProgress >= 1
              ? t("calibration.nailedIt")
              : `${isSpeakingDisplay ? t("calibration.speaking") : t("calibration.notSpeaking")}  ${(speechProgress * (SPEECH_TARGET_MS / 1000)).toFixed(1)} / 5.0 s`}
          </span>
        </div>
      )}
      {testing && (
        <div className={panelStyles.micTestRow}>
          <VuMeter
            rms={rms}
            peak={peak}
            markers={[
              {
                value: settings.vad_threshold,
                variant: "open",
                title: `Open ${(settings.vad_threshold * 100).toFixed(1)}%`,
              },
              {
                value: settings.vad_threshold * settings.noise_gate_close_ratio,
                variant: "close",
                title: `Close ${(settings.vad_threshold * settings.noise_gate_close_ratio * 100).toFixed(1)}%`,
              },
            ]}
            talking={rms > settings.vad_threshold}
          />
        </div>
      )}
    </div>
  );
}

function ManualCalibrationView({
  settings,
  onChange,
  rms,
  peak,
  testing,
  onToggleTest,
  t,
}: Readonly<{
  settings: AudioSettings;
  onChange: (patch: Partial<AudioSettings>) => void;
  rms: number;
  peak: number;
  testing: boolean;
  onToggleTest: () => void;
  t: TFn;
}>) {
  const closeAbsolute = settings.vad_threshold * settings.noise_gate_close_ratio;

  const handleOpen = useCallback(
    (next: number) => {
      onChange({ vad_threshold: next });
    },
    [onChange],
  );

  const handleClose = useCallback(
    (next: number) => {
      const open = Math.max(settings.vad_threshold, next + 1e-4);
      const ratio = Math.min(0.99, Math.max(0.1, next / open));
      onChange({ noise_gate_close_ratio: ratio });
    },
    [onChange, settings.vad_threshold],
  );

  const markers: VuMarker[] = [
    {
      value: settings.vad_threshold,
      variant: "open",
      title: `Open ${(settings.vad_threshold * 100).toFixed(1)}%`,
      onChange: handleOpen,
      ariaLabel: "Open threshold",
    },
    {
      value: closeAbsolute,
      variant: "close",
      title: `Close ${(closeAbsolute * 100).toFixed(1)}%`,
      onChange: handleClose,
      ariaLabel: "Close threshold",
    },
  ];
  const talking = rms > settings.vad_threshold;

  return (
    <div className={panelStyles.calibrationView}>
      <p className={styles.fieldHint}>
        {t("calibration.manualHintPre")}
        <span className={panelStyles.legendOpen}>{t("calibration.manualHintOpenWord")}</span>
        {" "}{t("calibration.manualHintMid")}
        <span className={panelStyles.legendClose}>{t("calibration.manualHintCloseWord")}</span>
        {" "}{t("calibration.manualHintPost")}
      </p>
      <VuMeter rms={rms} peak={peak} markers={markers} talking={talking} />
      <div className={panelStyles.micTestRow}>
        <button
          type="button"
          className={`${panelStyles.micTestBtn} ${testing ? panelStyles.micTestActive : ""}`}
          onClick={onToggleTest}
        >
          {testing ? t("calibration.stopTest") : t("calibration.testMic")}
        </button>
        <span className={styles.fieldHint}>
          {testing
            ? talking
              ? t("calibration.transmittingNow")
              : t("calibration.belowThreshold")
            : t("calibration.pressTestMic")}
        </span>
      </div>
      <SliderField
        label={t("calibration.holdFramesLabel")}
        hint={t("calibration.holdFramesHint")}
        min={1}
        max={50}
        step={1}
        value={settings.hold_frames}
        onChange={(v) => onChange({ hold_frames: v })}
        format={(v) => `${v}`}
      />
    </div>
  );
}

const REPLAY_CAPACITY_MS = 20_000;

function replayProgress(phase: ReplayPhase): number {
  switch (phase.phase) {
    case "recording":
      return phase.capacity_ms > 0 ? phase.elapsed_ms / phase.capacity_ms : 0;
    case "playing":
      return (phase.total_ms - phase.elapsed_ms) / REPLAY_CAPACITY_MS;
    default:
      return 0;
  }
}

function ReplayControl({ phase, t }: Readonly<{ phase: ReplayPhase; t: TFn }>) {
  const toggle = useCallback(async () => {
    try {
      if (phase.phase === "idle") {
        await invoke("start_voice_replay");
      } else {
        await invoke("stop_voice_replay");
      }
    } catch (e) {
      console.error("Voice replay failed:", e);
    }
  }, [phase.phase]);

  const label = (() => {
    switch (phase.phase) {
      case "idle":
        return t("calibration.recordSample");
      case "recording":
        return t("calibration.stopReplaySeconds", {
          elapsed: Math.round(phase.elapsed_ms / 1000),
          total: Math.round(phase.capacity_ms / 1000),
        });
      case "playing":
        return t("calibration.stopPlaybackSeconds", {
          elapsed: Math.round(phase.elapsed_ms / 1000),
          total: Math.round(phase.total_ms / 1000),
        });
    }
  })();

  const isActive = phase.phase !== "idle";
  const progress = replayProgress(phase);
  const fillPercent = Math.min(100, Math.max(0, progress * 100));

  return (
    <div className={panelStyles.replaySection}>
      <div className={panelStyles.replayHeader}>
        <span className={styles.fieldLabel}>{t("calibration.hearYourself")}</span>
        <p className={styles.fieldHint}>
          {t("calibration.hearYourselfHint", { seconds: REPLAY_CAPACITY_MS / 1000 })}
        </p>
      </div>
      <button
        type="button"
        className={`${panelStyles.micTestBtn} ${panelStyles.replayBtn} ${isActive ? panelStyles.micTestActive : ""}`}
        onClick={toggle}
      >
        {isActive && (
          <span
            className={`${panelStyles.replayBtnFill} ${phase.phase === "recording" ? panelStyles.replayBtnFillRecording : panelStyles.replayBtnFillPlaying}`}
            style={{ width: `${fillPercent}%` }}
          />
        )}
        <span className={panelStyles.replayBtnLabel}>{label}</span>
      </button>
    </div>
  );
}

export function CalibrationPanel({
  settings,
  onChange,
}: Readonly<{
  settings: AudioSettings;
  onChange: (patch: Partial<AudioSettings>) => void;
}>) {
  const { t } = useTranslation("settings");
  const tFn = t as TFn;
  const [testing, setTesting] = useState(false);
  const testingRef = useRef(false);
  const amplitudeRef = useRef({ rms: 0, peak: 0 });
  const [ampTick, setAmpTick] = useState(0);
  const rafHandle = useRef(0);
  const [replayPhase, setReplayPhase] = useState<ReplayPhase>({ phase: "idle" });
  // Keep the latest settings reachable from the calibration event
  // listener without re-subscribing on every settings change.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  // `undefined` until the persisted signature is read from the
  // preferences store; `null` once read with no prior calibration.
  const [calibratedSig, setCalibratedSig] = useState<string | null | undefined>(
    undefined,
  );
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

  const toggleTest = useCallback(async () => {
    if (testingRef.current) {
      await invoke("stop_mic_test").catch(() => {});
      setTesting(false);
      testingRef.current = false;
      amplitudeRef.current = { rms: 0, peak: 0 };
      setAmpTick((t) => t + 1);
    } else {
      try {
        await invoke("start_mic_test");
        setTesting(true);
        testingRef.current = true;
      } catch (e) {
        console.error("Mic test failed:", e);
      }
    }
  }, []);

  useEffect(() => {
    speechMsRef.current = 0;
    lastAmplitudeEventTime.current = null;
    if (!testing) return;
    const unlisten = listen<{ rms: number; peak: number }>(
      "mic-amplitude",
      (event) => {
        const now = performance.now();
        const prev = lastAmplitudeEventTime.current;
        lastAmplitudeEventTime.current = now;
        if (prev !== null && event.payload.rms > speechThresholdRef.current) {
          speechMsRef.current = Math.min(
            speechMsRef.current + (now - prev),
            SPEECH_TARGET_MS,
          );
        }
        amplitudeRef.current = event.payload;
        cancelAnimationFrame(rafHandle.current);
        rafHandle.current = requestAnimationFrame(() =>
          setAmpTick((t) => t + 1),
        );
      },
    );
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
    type Payload =
      | { phase: "idle" }
      | { phase: "recording"; elapsed_ms: number; capacity_ms: number }
      | { phase: "playing"; elapsed_ms: number; total_ms: number };
    const unlisten = listen<Payload>("voice-replay-state", (event) => {
      setReplayPhase(event.payload);
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  useEffect(() => {
    return () => {
      invoke("stop_voice_replay").catch(() => {});
    };
  }, []);

  void ampTick;
  const { rms, peak } = amplitudeRef.current;
  const mode: CalibrationMode = settings.auto_input_sensitivity ? "auto" : "manual";

  return (
    <div className={panelStyles.calibrationContainer}>
      <CalibrationModeSelector
        mode={mode}
        onChange={(next) =>
          onChange({ auto_input_sensitivity: next === "auto" })
        }
        t={tFn}
      />
      {mode === "auto" ? (
        <AutoCalibrationView
          settings={settings}
          rms={rms}
          peak={peak}
          testing={testing}
          onToggleTest={toggleTest}
          hasCalibrated={hasCalibrated}
          speechProgress={Math.min(speechMsRef.current / SPEECH_TARGET_MS, 1)}
          t={tFn}
        />
      ) : (
        <ManualCalibrationView
          settings={settings}
          onChange={onChange}
          rms={rms}
          peak={peak}
          testing={testing}
          onToggleTest={toggleTest}
          t={tFn}
        />
      )}
      <ReplayControl phase={replayPhase} t={tFn} />
    </div>
  );
}

