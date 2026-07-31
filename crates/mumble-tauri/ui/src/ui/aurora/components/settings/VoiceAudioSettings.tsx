import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AudioDevice, AudioSettings, DenoiserParamSpec, NoiseSuppressionAlgorithm } from "@core/types";
import { NOISE_SUPPRESSION_LABELS } from "@core/types";
import { saveAudioSettings } from "@core/preferencesStorage";
import { MicOffIcon, SparklesIcon } from "@ui/icons";
import { Button, Slider } from "../primitives";
import {
  SettingsCallout,
  SettingsColumns,
  SettingsField,
  SettingsGroup,
  SettingsInput,
  SettingsMeterRow,
  SettingsOptionCards,
  SettingsRadioGroup,
  SettingsSelect,
  SettingsToggleRow,
} from "./layout";
import { ACTIVATION_OPTIONS, DENOISER_DESCRIPTIONS, FRAME_SIZE_OPTIONS } from "./voiceOptions";
import styles from "../../AuroraClientExtensions.module.css";

type ReplayPhase =
  | { phase: "idle" }
  | { phase: "recording"; elapsed_ms: number; capacity_ms: number }
  | { phase: "playing"; elapsed_ms: number; total_ms: number };

export default function VoiceAudioSettings() {
  const [settings, setSettings] = useState<AudioSettings | null>(null);
  const [inputs, setInputs] = useState<AudioDevice[]>([]);
  const [outputs, setOutputs] = useState<AudioDevice[]>([]);
  const [algorithms, setAlgorithms] = useState<NoiseSuppressionAlgorithm[]>(["none"]);
  const [paramSpecs, setParamSpecs] = useState<DenoiserParamSpec[]>([]);
  const [rodioBackend, setRodioBackend] = useState(true);
  const [micLevel, setMicLevel] = useState(0);
  const [testing, setTesting] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [replay, setReplay] = useState<ReplayPhase>({ phase: "idle" });
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([
      invoke<AudioSettings>("get_audio_settings"),
      invoke<AudioDevice[]>("get_audio_devices"),
      invoke<AudioDevice[]>("get_output_devices"),
      invoke<NoiseSuppressionAlgorithm[]>("get_available_denoiser_algorithms"),
    ])
      .then(([current, inputDevices, outputDevices, available]) => {
        setSettings(current);
        setInputs(inputDevices);
        setOutputs(outputDevices);
        setAlgorithms(available);
      })
      .catch((reason) => setStatus(String(reason)));
    void invoke<boolean>("get_audio_backend").then(setRodioBackend);
    void invoke("probe_microphone");
    const amplitude = listen<{ rms: number }>("mic-amplitude", (event) =>
      setMicLevel(Math.min(1, event.payload.rms)),
    );
    const capture = listen<{ message: string } | null>("capture-error", (event) =>
      setCaptureError(event.payload?.message ?? null),
    );
    const replayState = listen<ReplayPhase>("voice-replay-state", (event) => setReplay(event.payload));
    return () => {
      void amplitude.then((off) => off());
      void capture.then((off) => off());
      void replayState.then((off) => off());
      void invoke("stop_mic_test");
      void invoke("stop_voice_replay");
    };
  }, []);
  useEffect(() => {
    if (settings?.denoiser_algorithm)
      void invoke<DenoiserParamSpec[]>("get_denoiser_param_specs", { algorithm: settings.denoiser_algorithm })
        .then(setParamSpecs)
        .catch(() => setParamSpecs([]));
  }, [settings?.denoiser_algorithm]);

  const patch = async (change: Partial<AudioSettings>) => {
    if (!settings) return;
    const next = { ...settings, ...change };
    setSettings(next);
    setStatus("Saving…");
    try {
      await Promise.all([invoke("set_audio_settings", { settings: next }), saveAudioSettings(next)]);
      setStatus("Saved");
    } catch (reason) {
      setStatus(`Could not save: ${String(reason)}`);
    }
  };
  const toggleTest = async () => {
    try {
      await invoke(testing ? "stop_mic_test" : "start_mic_test");
      setTesting(!testing);
      if (testing) setMicLevel(0);
    } catch (reason) {
      setCaptureError(String(reason));
    }
  };
  const toggleReplay = async () => {
    try {
      await invoke(replay.phase === "idle" ? "start_voice_replay" : "stop_voice_replay");
    } catch (reason) {
      setCaptureError(String(reason));
    }
  };
  if (!settings)
    return <div className={styles.directoryState}>Loading audio devices and processing settings…</div>;

  const denoiserOptions = algorithms.map((algorithm) => ({
    value: algorithm,
    label: NOISE_SUPPRESSION_LABELS[algorithm],
    description: DENOISER_DESCRIPTIONS[algorithm],
    icon: algorithm === "none" ? <MicOffIcon /> : <SparklesIcon />,
  }));

  return (
    <>
      {captureError && (
        <SettingsCallout tone="danger" title="Microphone unavailable">
          {captureError}
        </SettingsCallout>
      )}

      <SettingsGroup title="Devices" description="Which hardware carries your voice in and out.">
        <SettingsColumns>
          <SettingsField label="Input device" hint="Used for voice transmission.">
            <SettingsSelect
              label="Input device"
              value={settings.selected_device ?? ""}
              onChange={(event) => void patch({ selected_device: event.target.value || null })}
            >
              <option value="">System default</option>
              {inputs.map((device) => (
                <option key={device.name} value={device.name}>
                  {device.name}
                  {device.is_default ? " (default)" : ""}
                </option>
              ))}
            </SettingsSelect>
          </SettingsField>
          <SettingsField label="Output device" hint="Used for incoming voice.">
            <SettingsSelect
              label="Output device"
              value={settings.selected_output_device ?? ""}
              onChange={(event) => void patch({ selected_output_device: event.target.value || null })}
            >
              <option value="">System default</option>
              {outputs.map((device) => (
                <option key={device.name} value={device.name}>
                  {device.name}
                  {device.is_default ? " (default)" : ""}
                </option>
              ))}
            </SettingsSelect>
          </SettingsField>
        </SettingsColumns>

        <SettingsColumns>
          <SettingsField
            label="Microphone volume"
            value={`${Math.round(settings.input_volume * 100)}%`}
            hint="Gain applied before voice processing."
          >
            <Slider
              label="Microphone volume"
              value={settings.input_volume}
              min={0}
              max={2}
              step={0.05}
              onChange={(value) => void patch({ input_volume: value })}
            />
          </SettingsField>
          <SettingsField
            label="Speaker volume"
            value={`${Math.round(settings.output_volume * 100)}%`}
            hint="Master level for incoming voice."
          >
            <Slider
              label="Speaker volume"
              value={settings.output_volume}
              min={0}
              max={2}
              step={0.05}
              onChange={(value) => void patch({ output_volume: value })}
            />
          </SettingsField>
        </SettingsColumns>
      </SettingsGroup>

      <SettingsGroup title="Activation mode" description="Choose how your microphone is activated.">
        <SettingsOptionCards
          label="Activation mode"
          value={settings.push_to_talk ? "ptt" : "vad"}
          onSelect={(mode) => void patch({ push_to_talk: mode === "ptt" })}
          options={ACTIVATION_OPTIONS}
        />

        {settings.push_to_talk ? (
          <SettingsField
            label="Push-to-talk shortcut"
            hint="Global shortcut recognized by the native client."
          >
            <SettingsInput
              label="Push-to-talk shortcut"
              value={settings.push_to_talk_key ?? ""}
              onChange={(event) => void patch({ push_to_talk_key: event.target.value || null })}
              placeholder="Example: Alt+T"
            />
          </SettingsField>
        ) : (
          <>
            <SettingsField
              label="Voice activation threshold"
              value={`${Math.round(settings.vad_threshold * 100)}%`}
              hint="The microphone opens above this level."
            >
              <Slider
                label="Voice activation threshold"
                value={settings.vad_threshold}
                min={0}
                max={1}
                step={0.01}
                onChange={(value) => void patch({ vad_threshold: value })}
              />
            </SettingsField>
            <SettingsToggleRow
              title="Automatic input sensitivity"
              detail="Adapt the threshold to ambient noise."
              checked={settings.auto_input_sensitivity}
              onToggle={() => void patch({ auto_input_sensitivity: !settings.auto_input_sensitivity })}
            />
          </>
        )}
      </SettingsGroup>

      <SettingsGroup
        title="Voice gate"
        description="How far the signal must fall before you stop transmitting."
      >
        <SettingsColumns>
          <SettingsField
            label="Close ratio"
            value={settings.noise_gate_close_ratio.toFixed(2)}
            hint="Fraction of the open threshold at which transmission stops."
          >
            <Slider
              label="Close ratio"
              value={settings.noise_gate_close_ratio}
              min={0.1}
              max={1}
              step={0.05}
              onChange={(value) => void patch({ noise_gate_close_ratio: value })}
            />
          </SettingsField>
          <SettingsField
            label="Hold time"
            value={`${settings.hold_frames} frames`}
            hint="How long the gate stays open after speech, so pauses do not clip."
          >
            <Slider
              label="Hold time"
              value={settings.hold_frames}
              min={1}
              max={50}
              step={1}
              onChange={(value) => void patch({ hold_frames: value })}
            />
          </SettingsField>
        </SettingsColumns>
      </SettingsGroup>

      <SettingsGroup
        title="Noise suppression"
        description="Reduces background noise before your voice reaches listeners."
      >
        <SettingsOptionCards
          label="Noise suppression"
          value={settings.denoiser_algorithm}
          onSelect={(algorithm) =>
            void patch({ denoiser_algorithm: algorithm, noise_suppression: algorithm !== "none" })
          }
          options={denoiserOptions}
        />
        {paramSpecs.map((spec) => (
          <SettingsField
            key={spec.id}
            label={spec.label}
            value={`${settings.denoiser_params[spec.id] ?? spec.default}${spec.unit ? ` ${spec.unit}` : ""}`}
            hint={spec.description}
          >
            <Slider
              label={spec.label}
              value={settings.denoiser_params[spec.id] ?? spec.default}
              min={spec.min}
              max={spec.max}
              step={spec.step}
              onChange={(value) =>
                void patch({ denoiser_params: { ...settings.denoiser_params, [spec.id]: value } })
              }
            />
          </SettingsField>
        ))}
      </SettingsGroup>

      <SettingsGroup title="Audio processing">
        <SettingsToggleRow
          title="Auto gain"
          detail="Automatically adjusts microphone volume for consistent levels."
          checked={settings.auto_gain}
          onToggle={() => void patch({ auto_gain: !settings.auto_gain })}
        />
        {settings.auto_gain && (
          <SettingsField
            label="Maximum gain"
            value={`${settings.max_gain_db} dB`}
            hint="Upper limit on the boost applied to a quiet microphone."
          >
            <Slider
              label="Maximum gain"
              value={settings.max_gain_db}
              min={0}
              max={30}
              step={1}
              onChange={(value) => void patch({ max_gain_db: value })}
            />
          </SettingsField>
        )}
      </SettingsGroup>

      <SettingsGroup title="Compression">
        <SettingsField
          label="Quality"
          value={`${Math.round(settings.bitrate_bps / 1000)} kb/s`}
          hint="Higher bitrate means better audio quality but more bandwidth."
        >
          <Slider
            label="Quality"
            value={settings.bitrate_bps}
            min={16000}
            max={128000}
            step={8000}
            onChange={(value) => void patch({ bitrate_bps: value })}
          />
        </SettingsField>
        <SettingsField
          label="Audio per packet"
          value={`${settings.frame_size_ms} ms`}
          hint="Smaller values reduce latency; larger values are more bandwidth-efficient."
        >
          <SettingsRadioGroup
            label="Audio per packet"
            value={settings.frame_size_ms}
            onSelect={(frame_size_ms) => void patch({ frame_size_ms })}
            options={FRAME_SIZE_OPTIONS}
          />
        </SettingsField>
      </SettingsGroup>

      <SettingsGroup title="Network">
        <SettingsToggleRow
          title="Force TCP audio"
          detail="Always send audio over the TCP tunnel instead of UDP. Use this if you are behind a strict firewall or NAT that blocks UDP traffic."
          checked={settings.force_tcp_audio}
          onToggle={() => void patch({ force_tcp_audio: !settings.force_tcp_audio })}
        />
      </SettingsGroup>

      <SettingsGroup title="Device">
        <SettingsToggleRow
          title="Exclusive microphone mode"
          detail="Connect straight to the driver. Fixes 'device in use' errors on interfaces that only allow one app at non-48 kHz rates. While active, other apps cannot use the microphone."
          checked={settings.exclusive_input ?? false}
          onToggle={() => void patch({ exclusive_input: !settings.exclusive_input })}
        />
      </SettingsGroup>

      <SettingsGroup title="Check your setup" description="Nothing here is transmitted to the server.">
        <SettingsMeterRow
          title="Microphone test"
          detail="Measure the processed input without transmitting."
          level={micLevel}
        >
          <Button onClick={() => void toggleTest()}>{testing ? "Stop test" : "Test microphone"}</Button>
        </SettingsMeterRow>
        <SettingsMeterRow
          title="Hear yourself"
          detail="Record a short sample through the same filters your listeners receive, then play it back."
          level={
            replay.phase === "recording"
              ? replay.elapsed_ms / Math.max(1, replay.capacity_ms)
              : replay.phase === "playing"
                ? replay.elapsed_ms / Math.max(1, replay.total_ms)
                : 0
          }
        >
          <Button onClick={() => void toggleReplay()}>
            {replay.phase === "idle"
              ? "Record sample"
              : replay.phase === "recording"
                ? `Stop (${Math.round(replay.elapsed_ms / 1000)}s)`
                : `Stop playback (${Math.round(replay.elapsed_ms / 1000)}s)`}
          </Button>
        </SettingsMeterRow>
      </SettingsGroup>

      <SettingsGroup title="Expert">
        <SettingsToggleRow
          title="Legacy audio backend"
          detail="Switch to the legacy cpal audio backend if you experience issues with the default rodio backend. Takes effect on the next voice toggle."
          checked={!rodioBackend}
          onToggle={() => {
            const useRodio = !rodioBackend ? true : false;
            setRodioBackend(useRodio);
            void invoke("set_audio_backend", { useRodio });
          }}
        />
        {status && <SettingsCallout title="Save state">{status}</SettingsCallout>}
      </SettingsGroup>
    </>
  );
}
