import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { AudioSettings } from "@core/types";
import { SparklesIcon, SlidersIcon } from "../../icons";
import { SliderField } from "./SharedControls";
import { VuMeter, type VuMarker } from "./VuMeter";
import { RadioCardGroup, type RadioCardOption } from "../../components/elements/RadioCardGroup";
import {
  REPLAY_CAPACITY_MS,
  SPEECH_TARGET_MS,
  replayProgress,
  useVoiceCalibration,
  type ReplayPhase,
} from "./useVoiceCalibration";
import styles from "./SettingsPage.module.css";
import panelStyles from "./CalibrationPanel.module.css";

type TFn = (key: string, opts?: Record<string, unknown>) => string;

type CalibrationMode = "auto" | "manual";

type ModeOption = RadioCardOption<CalibrationMode>;

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
    <RadioCardGroup name="calibration_mode" options={buildModeOptions(t)} value={mode} onChange={onChange} />
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
  isSpeakingDisplay,
  t,
}: Readonly<{
  settings: AudioSettings;
  rms: number;
  peak: number;
  testing: boolean;
  onToggleTest: () => void;
  hasCalibrated: boolean;
  speechProgress: number;
  isSpeakingDisplay: boolean;
  t: TFn;
}>) {
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
            {t("calibration.hold")}{" "}
            <strong>
              {settings.hold_frames} {t("calibration.frames")}
            </strong>
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
          <div className={panelStyles.speechProgressFill} style={{ width: `${speechProgress * 100}%` }} />
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
        <span className={panelStyles.legendOpen}>{t("calibration.manualHintOpenWord")}</span>{" "}
        {t("calibration.manualHintMid")}
        <span className={panelStyles.legendClose}>{t("calibration.manualHintCloseWord")}</span>{" "}
        {t("calibration.manualHintPost")}
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

function ReplayControl({
  phase,
  onToggle,
  t,
}: Readonly<{ phase: ReplayPhase; onToggle: () => void; t: TFn }>) {
  const toggle = onToggle;

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
  const calibration = useVoiceCalibration(settings, onChange);
  const mode: CalibrationMode = settings.auto_input_sensitivity ? "auto" : "manual";

  return (
    <div className={panelStyles.calibrationContainer}>
      <CalibrationModeSelector
        mode={mode}
        onChange={(next) => onChange({ auto_input_sensitivity: next === "auto" })}
        t={tFn}
      />
      {mode === "auto" ? (
        <AutoCalibrationView
          settings={settings}
          rms={calibration.rms}
          peak={calibration.peak}
          testing={calibration.testing}
          onToggleTest={calibration.toggleTest}
          hasCalibrated={calibration.hasCalibrated}
          speechProgress={calibration.speechProgress}
          isSpeakingDisplay={calibration.speaking}
          t={tFn}
        />
      ) : (
        <ManualCalibrationView
          settings={settings}
          onChange={onChange}
          rms={calibration.rms}
          peak={calibration.peak}
          testing={calibration.testing}
          onToggleTest={calibration.toggleTest}
          t={tFn}
        />
      )}
      <ReplayControl phase={calibration.replay} onToggle={calibration.toggleReplay} t={tFn} />
    </div>
  );
}
