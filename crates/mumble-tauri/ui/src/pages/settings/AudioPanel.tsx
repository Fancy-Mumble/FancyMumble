import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
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
import panelStyles from "./AudioPanel.module.css";
import { registerSettings } from "./settingsSearchRegistry";

registerSettings("voice")
  .add("audio.inputDevice", ["microphone", "mic"])
  .add("audio.outputDevice", ["speaker", "headphones"])
  .add("audio.activationMode", ["voice activity", "vad", "push to talk", "ptt"])
  .add("audio.noiseSuppression", ["denoise", "background noise"])
  .add("audio.audioProcessing", ["echo", "gain"])
  .add("audio.compression")
  .add("audio.network", ["jitter", "bandwidth"])
  .add("audio.stats.title", ["statistics", "debug"])
  .add("audio.expert");

const FRAME_SIZE_OPTIONS = [
  { value: 10, label: "10 ms" },
  { value: 20, label: "20 ms" },
  { value: 40, label: "40 ms" },
  { value: 60, label: "60 ms" },
];

function buildDenoiserOptions(t: (key: string) => string): readonly RadioCardOption<NoiseSuppressionAlgorithm>[] {
  return [
    {
      value: "none",
      label: t("audio.denoiser.off"),
      description: t("audio.denoiser.offDesc"),
      Icon: MicOffIcon,
    },
    {
      value: "rnnoise",
      label: t("audio.denoiser.rnnoise"),
      description: t("audio.denoiser.rnnoiseDesc"),
      Icon: ActivityIcon,
    },
    {
      value: "deepfilternet",
      label: t("audio.denoiser.deepfilternet"),
      description: t("audio.denoiser.deepfilternetDesc"),
      Icon: SparklesIcon,
    },
    {
      value: "omlsa_imcra",
      label: t("audio.denoiser.omlsa"),
      description: t("audio.denoiser.omlsaDesc"),
      Icon: SlidersIcon,
    },
    {
      value: "spectral_subtraction",
      label: t("audio.denoiser.spectral"),
      description: t("audio.denoiser.spectralDesc"),
      Icon: AudioWaveformIcon,
    },
  ];
}

function StatsRow({ label, stats }: Readonly<{ label: string; stats: PacketStats }>) {
  const total = stats.good + stats.late + stats.lost;
  const lossPercent = total > 0 ? ((stats.lost / total) * 100).toFixed(1) : "0.0";
  return (
    <div className={panelStyles.statsRow}>
      <span className={panelStyles.statsLabel}>{label}</span>
      <span className={panelStyles.statsValues}>
        {stats.good} good &middot; {stats.late} late &middot; {stats.lost} lost ({lossPercent}%) &middot; {stats.resync} resync
      </span>
    </div>
  );
}

function AudioStatsSection() {
  const { t } = useTranslation("settings");
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
        <h3 className={styles.sectionTitle}>{t("audio.stats.title")}</h3>
        <p className={styles.fieldHint}>
          {t("audio.stats.noStats")}
        </p>
      </section>
    );
  }

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{t("audio.stats.title")}</h3>
      <p className={styles.fieldHint}>
        {t("audio.stats.udpCounters")}
      </p>
      <StatsRow label={t("audio.stats.toClient")} stats={cryptoStats.to_client} />
      <StatsRow label={t("audio.stats.fromClient")} stats={cryptoStats.from_client} />
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
  const { t } = useTranslation("settings");
  const tStr = t as (key: string) => string;
  const denoiserOptions = buildDenoiserOptions(tStr);
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
      <h2 className={styles.panelTitle}>{t("audio.panelTitle")}</h2>

      {/* -- Input & Output Devices (side by side) ---------- */}
      <section className={styles.section}>
        <div className={panelStyles.deviceColumns}>
          <div className={panelStyles.deviceColumn}>
            <h3 className={styles.sectionTitle}>{t("audio.inputDevice")}</h3>
            <select
              className={styles.select}
              value={settings.selected_device ?? ""}
              onChange={(e) =>
                onChange({
                  selected_device: e.target.value === "" ? null : e.target.value,
                })
              }
            >
              <option value="">{t("audio.systemDefault")}</option>
              {devices.map((d, i) => (
                <option key={`in-${i}-${d.name}`} value={d.name}>
                  {d.name}
                  {d.is_default ? ` ${t("audio.deviceDefault")}` : ""}
                </option>
              ))}
            </select>
            <SliderField
              label={t("audio.microphoneVolume")}
              min={0}
              max={2}
              step={0.01}
              value={settings.input_volume}
              onChange={(v) => onChange({ input_volume: v })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          </div>

          <div className={panelStyles.deviceColumn}>
            <h3 className={styles.sectionTitle}>{t("audio.outputDevice")}</h3>
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
              <option value="">{t("audio.systemDefault")}</option>
              {outputDevices.map((d, i) => (
                <option key={`out-${i}-${d.name}`} value={d.name}>
                  {d.name}
                  {d.is_default ? ` ${t("audio.deviceDefault")}` : ""}
                </option>
              ))}
            </select>
            <SliderField
              label={t("audio.speakerVolume")}
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
        <h3 className={styles.sectionTitle}>{t("audio.activationMode")}</h3>
        <p className={styles.fieldHint}>
          {t("audio.activationModeHint")}
        </p>
        <ActivationModeSelector settings={settings} onChange={onChange} />
        {settings.push_to_talk && (
          <p
            className={styles.fieldHint}
            dangerouslySetInnerHTML={{ __html: t("audio.pttHint", { tab: t("audio.shortcutsTab") }) }}
          />
        )}
        {isVoiceGate && (
          <>
            <h4 className={styles.groupTitle}>{t("audio.voiceGate")}</h4>
            <CalibrationPanel settings={settings} onChange={onChange} />
          </>
        )}
      </section>

      {/* -- Noise Suppression --------------------------------------- */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{t("audio.noiseSuppression")}</h3>
        <p className={styles.fieldHint}>
          {t("audio.noiseSuppressionHint")}
        </p>
        <RadioCardGroup
          name="denoiser_algorithm"
          options={denoiserOptions.filter((o) => availableAlgorithms.includes(o.value))}
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
        <h3 className={styles.sectionTitle}>{t("audio.audioProcessing")}</h3>

        <div className={styles.toggleRow}>
          <div className={styles.toggleInfo}>
            <span className={styles.fieldLabel}>{t("audio.autoGain")}</span>
            <p className={styles.fieldHint}>
              {t("audio.autoGainHint")}
            </p>
          </div>
          <Toggle
            checked={settings.auto_gain}
            onChange={() => onChange({ auto_gain: !settings.auto_gain })}
          />
        </div>

        {settings.auto_gain && !settings.auto_input_sensitivity && (
          <SliderField
            label={t("audio.maxAmplification")}
            hint={t("audio.maxAmplificationHint")}
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
        <h3 className={styles.sectionTitle}>{t("audio.compression")}</h3>
        <SliderField
          label={t("audio.quality")}
          hint={t("audio.qualityHint")}
          min={8}
          max={320}
          step={8}
          value={settings.bitrate_bps / 1000}
          onChange={(v) => onChange({ bitrate_bps: v * 1000 })}
          format={(v) => `${v} kb/s`}
        />
        <div className={styles.field}>
          <div className={styles.fieldRow}>
            <span className={styles.fieldLabel}>{t("audio.audioPerPacket")}</span>
            <span className={styles.sliderValue}>
              {settings.frame_size_ms} ms
            </span>
          </div>
          <p className={styles.fieldHint}>
            {t("audio.audioPerPacketHint")}
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
        <h3 className={styles.sectionTitle}>{t("audio.network")}</h3>

        <div className={styles.toggleRow}>
          <div className={styles.toggleInfo}>
            <span className={styles.fieldLabel}>{t("audio.forceTcpAudio")}</span>
            <p className={styles.fieldHint}>
              {t("audio.forceTcpAudioHint")}
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
          <h3 className={styles.sectionTitle}>{t("audio.expert")}</h3>
          <div className={styles.toggleRow}>
            <div className={styles.toggleInfo}>
              <span className={styles.fieldLabel}>{t("audio.legacyAudioBackend")}</span>
              <p className={styles.fieldHint}>
                {t("audio.legacyAudioBackendHint")}
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
