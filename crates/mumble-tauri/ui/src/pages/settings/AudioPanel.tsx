import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  AudioDevice,
  AudioSettings,
  CryptoStats,
  NoiseSuppressionAlgorithm,
  PacketStats,
} from "../../types";
import {
  ActivityIcon,
  AudioWaveformIcon,
  MicOffIcon,
  SlidersIcon,
  SparklesIcon,
} from "../../icons";
import { isDesktopPlatform } from "../../utils/platform";
import { Toggle, SliderField } from "./SharedControls";
import { DenoiserAdvancedControls } from "./DenoiserAdvancedControls";
import { ActivationModeSelector } from "./ActivationModeSelector";
import { CalibrationPanel } from "./CalibrationPanel";
import { RadioCardGroup, type RadioCardOption } from "../../components/elements/RadioCardGroup";
import styles from "./SettingsPage.module.css";

const FRAME_SIZE_OPTIONS = [
  { value: 10, label: "10 ms" },
  { value: 20, label: "20 ms" },
  { value: 40, label: "40 ms" },
  { value: 60, label: "60 ms" },
];

const DENOISER_OPTIONS: readonly RadioCardOption<NoiseSuppressionAlgorithm>[] = [
  {
    value: "none",
    label: "Off",
    description: "No noise processing. Raw microphone audio is transmitted as-is.",
    Icon: MicOffIcon,
  },
  {
    value: "rnnoise",
    label: "RNNoise",
    description: "Neural network trained on real speech. Works well in most environments.",
    Icon: ActivityIcon,
  },
  {
    value: "deepfilternet",
    label: "DeepFilterNet",
    description: "State-of-the-art deep learning. Best quality; higher CPU cost.",
    Icon: SparklesIcon,
  },
  {
    value: "omlsa_imcra",
    label: "OMLSA + IMCRA",
    description: "Modern classical estimator. Very smooth suppression output.",
    Icon: SlidersIcon,
  },
  {
    value: "spectral_subtraction",
    label: "Spectral Subtraction",
    description: "Lightest option. Ideal for steady background noise.",
    Icon: AudioWaveformIcon,
  },
];

function StatsRow({ label, stats }: Readonly<{ label: string; stats: PacketStats }>) {
  const total = stats.good + stats.late + stats.lost;
  const lossPercent = total > 0 ? ((stats.lost / total) * 100).toFixed(1) : "0.0";
  return (
    <div className={styles.statsRow}>
      <span className={styles.statsLabel}>{label}</span>
      <span className={styles.statsValues}>
        {stats.good} good &middot; {stats.late} late &middot; {stats.lost} lost ({lossPercent}%) &middot; {stats.resync} resync
      </span>
    </div>
  );
}

function AudioStatsSection() {
  const [cryptoStats, setCryptoStats] = useState<CryptoStats | null>(null);

  useEffect(() => {
    const unlisten = listen<CryptoStats>("crypto-stats", (event) => {
      setCryptoStats(event.payload);
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  if (!cryptoStats) {
    return (
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Audio Statistics</h3>
        <p className={styles.fieldHint}>
          No statistics available. Connect to a server to see packet statistics.
        </p>
      </section>
    );
  }

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>Audio Statistics</h3>
      <p className={styles.fieldHint}>
        UDP packet counters since connection start.
      </p>
      <StatsRow label="To Client (server sent)" stats={cryptoStats.to_client} />
      <StatsRow label="From Client (we received)" stats={cryptoStats.from_client} />
    </section>
  );
}

export function AudioPanel({
  devices,
  outputDevices,
  settings,
  onChange,
  isExpert,
  useRodioBackend,
  onToggleAudioBackend,
}: Readonly<{
  devices: AudioDevice[];
  outputDevices: AudioDevice[];
  settings: AudioSettings;
  onChange: (patch: Partial<AudioSettings>) => void;
  isExpert: boolean;
  useRodioBackend: boolean;
  onToggleAudioBackend: () => void;
}>) {
  const [availableAlgorithms, setAvailableAlgorithms] = useState<
    NoiseSuppressionAlgorithm[]
  >(["none", "omlsa_imcra", "spectral_subtraction"]);
  useEffect(() => {
    invoke<NoiseSuppressionAlgorithm[]>("get_available_denoiser_algorithms")
      .then((algos) => {
        if (Array.isArray(algos)) setAvailableAlgorithms(algos);
      })
      .catch(() => { /* keep the conservative default */ });
  }, []);

  const isVoiceGate = !settings.push_to_talk && settings.noise_suppression;

  return (
    <>
      <h2 className={styles.panelTitle}>Voice</h2>

      {/* -- Input & Output Devices (side by side) ---------- */}
      <section className={styles.section}>
        <div className={styles.deviceColumns}>
          <div className={styles.deviceColumn}>
            <h3 className={styles.sectionTitle}>Input Device</h3>
            <select
              className={styles.select}
              value={settings.selected_device ?? ""}
              onChange={(e) =>
                onChange({
                  selected_device: e.target.value === "" ? null : e.target.value,
                })
              }
            >
              <option value="">System default</option>
              {devices.map((d, i) => (
                <option key={`in-${i}-${d.name}`} value={d.name}>
                  {d.name}
                  {d.is_default ? " (default)" : ""}
                </option>
              ))}
            </select>
            <SliderField
              label="Microphone Volume"
              min={0}
              max={2}
              step={0.01}
              value={settings.input_volume}
              onChange={(v) => onChange({ input_volume: v })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          </div>

          <div className={styles.deviceColumn}>
            <h3 className={styles.sectionTitle}>Output Device</h3>
            <select
              className={styles.select}
              value={settings.selected_output_device ?? ""}
              onChange={(e) =>
                onChange({
                  selected_output_device:
                    e.target.value === "" ? null : e.target.value,
                })
              }
            >
              <option value="">System default</option>
              {outputDevices.map((d, i) => (
                <option key={`out-${i}-${d.name}`} value={d.name}>
                  {d.name}
                  {d.is_default ? " (default)" : ""}
                </option>
              ))}
            </select>
            <SliderField
              label="Speaker Volume"
              min={0}
              max={2}
              step={0.01}
              value={settings.output_volume}
              onChange={(v) => onChange({ output_volume: v })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          </div>
        </div>
      </section>

      {/* -- Activation Mode + Voice Gate ---------------------------- */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Activation Mode</h3>
        <p className={styles.fieldHint}>
          Choose how your microphone is activated.
        </p>
        <ActivationModeSelector settings={settings} onChange={onChange} />
        {settings.push_to_talk && (
          <p className={styles.fieldHint}>
            Configure the Push to Talk key under the{" "}
            <strong>Shortcuts</strong> tab.
          </p>
        )}
        {isVoiceGate && (
          <>
            <h4 className={styles.groupTitle}>Voice Gate</h4>
            <CalibrationPanel settings={settings} onChange={onChange} />
          </>
        )}
      </section>

      {/* -- Noise Suppression --------------------------------------- */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Noise Suppression</h3>
        <p className={styles.fieldHint}>
          Reduces background noise before your voice reaches listeners.
        </p>
        <RadioCardGroup
          name="denoiser_algorithm"
          options={DENOISER_OPTIONS.filter((o) => availableAlgorithms.includes(o.value))}
          value={settings.denoiser_algorithm}
          onChange={(denoiser_algorithm) => onChange({ denoiser_algorithm })}
        />
        {isExpert && (
          <DenoiserAdvancedControls
            algorithm={settings.denoiser_algorithm}
            settings={settings}
            onChange={onChange}
          />
        )}
      </section>

      {/* -- Audio Processing ------------------------------- */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Audio Processing</h3>

        <div className={styles.toggleRow}>
          <div className={styles.toggleInfo}>
            <span className={styles.fieldLabel}>Auto Gain</span>
            <p className={styles.fieldHint}>
              Automatically adjusts microphone volume for consistent levels.
            </p>
          </div>
          <Toggle
            checked={settings.auto_gain}
            onChange={() => onChange({ auto_gain: !settings.auto_gain })}
          />
        </div>

        {settings.auto_gain && !settings.auto_input_sensitivity && (
          <SliderField
            label="Max Amplification"
            hint="Maximum boost the auto-gain controller can apply. Auto-calibration accounts for this when picking the threshold."
            min={1}
            max={40}
            step={1}
            value={settings.max_gain_db}
            onChange={(v) => onChange({ max_gain_db: v })}
            format={(v) => `${Math.round(v)} dB`}
          />
        )}
      </section>

      {/* -- Compression ------------------------------------ */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Compression</h3>
        <SliderField
          label="Quality"
          hint="Higher bitrate means better audio quality but more bandwidth."
          min={8}
          max={320}
          step={8}
          value={settings.bitrate_bps / 1000}
          onChange={(v) => onChange({ bitrate_bps: v * 1000 })}
          format={(v) => `${v} kb/s`}
        />
        <div className={styles.field}>
          <div className={styles.fieldRow}>
            <span className={styles.fieldLabel}>Audio per packet</span>
            <span className={styles.sliderValue}>
              {settings.frame_size_ms} ms
            </span>
          </div>
          <p className={styles.fieldHint}>
            Smaller values reduce latency; larger values are more
            bandwidth-efficient.
          </p>
          <div className={styles.radioGroup}>
            {FRAME_SIZE_OPTIONS.map((opt) => (
              <label key={opt.value} className={styles.radioLabel}>
                <input
                  type="radio"
                  name="frame_size_ms"
                  value={opt.value}
                  checked={settings.frame_size_ms === opt.value}
                  onChange={() => onChange({ frame_size_ms: opt.value })}
                />
                {opt.label}
              </label>
            ))}
          </div>
        </div>
      </section>

      {/* -- Network ---------------------------------------- */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Network</h3>

        <div className={styles.toggleRow}>
          <div className={styles.toggleInfo}>
            <span className={styles.fieldLabel}>Force TCP Audio</span>
            <p className={styles.fieldHint}>
              Always send audio over the TCP tunnel instead of UDP.
              Use this if you are behind a strict firewall or NAT
              that blocks UDP traffic.
            </p>
          </div>
          <Toggle
            checked={settings.force_tcp_audio}
            onChange={() => onChange({ force_tcp_audio: !settings.force_tcp_audio })}
          />
        </div>
      </section>

      {/* -- Expert settings -------------------------------- */}
      {isExpert && isDesktopPlatform() && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Expert</h3>
          <div className={styles.toggleRow}>
            <div className={styles.toggleInfo}>
              <span className={styles.fieldLabel}>Legacy Audio Backend</span>
              <p className={styles.fieldHint}>
                Switch to the legacy cpal audio backend. Use this if you
                experience issues with the default rodio backend. Takes effect
                on the next voice toggle.
              </p>
            </div>
            <Toggle
              checked={!useRodioBackend}
              onChange={onToggleAudioBackend}
            />
          </div>
        </section>
      )}

      {/* -- Audio Statistics -------------------------------- */}
      {isExpert && <AudioStatsSection />}


    </>
  );
}
