import { useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AudioDevice, AudioSettings, DenoiserParamSpec, NoiseSuppressionAlgorithm } from "@core/types";
import { NOISE_SUPPRESSION_LABELS } from "@core/types";
import { saveAudioSettings } from "@core/preferencesStorage";
import { Button } from "../primitives";
import styles from "../../AuroraClientExtensions.module.css";

function SettingRow({ title, detail, children }: { title: string; detail: string; children: ReactNode }) { return <div className={styles.audioSetting}><span><strong>{title}</strong><small>{detail}</small></span>{children}</div>; }
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) { return <Button className={checked ? styles.audioToggleOn : styles.audioToggle} role="switch" aria-checked={checked} aria-label={label} onClick={onChange}><i /></Button>; }
function Slider({ value, min, max, step, onChange, format }: { value: number; min: number; max: number; step: number; onChange: (value: number) => void; format: (value: number) => string }) { return <label className={styles.audioSlider}><input type="range" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} /><b>{format(value)}</b></label>; }

type ReplayPhase = { phase: "idle" } | { phase: "recording"; elapsed_ms: number; capacity_ms: number } | { phase: "playing"; elapsed_ms: number; total_ms: number };

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
    void Promise.all([invoke<AudioSettings>("get_audio_settings"), invoke<AudioDevice[]>("get_audio_devices"), invoke<AudioDevice[]>("get_output_devices"), invoke<NoiseSuppressionAlgorithm[]>("get_available_denoiser_algorithms")])
      .then(([current, inputDevices, outputDevices, available]) => { setSettings(current); setInputs(inputDevices); setOutputs(outputDevices); setAlgorithms(available); })
      .catch((reason) => setStatus(String(reason)));
    void invoke<boolean>("get_audio_backend").then(setRodioBackend);
    void invoke("probe_microphone");
    const amplitude = listen<{ rms: number }>("mic-amplitude", (event) => setMicLevel(Math.min(1, event.payload.rms)));
    const capture = listen<{ message: string } | null>("capture-error", (event) => setCaptureError(event.payload?.message ?? null));
    const replayState = listen<ReplayPhase>("voice-replay-state", (event) => setReplay(event.payload));
    return () => { void amplitude.then((off) => off()); void capture.then((off) => off()); void replayState.then((off) => off()); void invoke("stop_mic_test"); void invoke("stop_voice_replay"); };
  }, []);
  useEffect(() => { if (settings?.denoiser_algorithm) void invoke<DenoiserParamSpec[]>("get_denoiser_param_specs", { algorithm: settings.denoiser_algorithm }).then(setParamSpecs).catch(() => setParamSpecs([])); }, [settings?.denoiser_algorithm]);

  const patch = async (change: Partial<AudioSettings>) => {
    if (!settings) return;
    const next = { ...settings, ...change };
    setSettings(next); setStatus("Saving…");
    try { await Promise.all([invoke("set_audio_settings", { settings: next }), saveAudioSettings(next)]); setStatus("Saved"); }
    catch (reason) { setStatus(`Could not save: ${String(reason)}`); }
  };
  const toggleTest = async () => {
    try { await invoke(testing ? "stop_mic_test" : "start_mic_test"); setTesting(!testing); if (testing) setMicLevel(0); }
    catch (reason) { setCaptureError(String(reason)); }
  };
  const toggleReplay = async () => {
    try { await invoke(replay.phase === "idle" ? "start_voice_replay" : "stop_voice_replay"); }
    catch (reason) { setCaptureError(String(reason)); }
  };
  if (!settings) return <div className={styles.directoryState}>Loading audio devices and processing settings…</div>;

  return <div className={styles.audioSettings}>
    {captureError && <div className={styles.formError} role="alert">Microphone unavailable: {captureError}</div>}
    <SettingRow title="Microphone" detail="Input device used for voice transmission."><select value={settings.selected_device ?? ""} onChange={(event) => void patch({ selected_device: event.target.value || null })}><option value="">System default</option>{inputs.map((device) => <option key={device.name} value={device.name}>{device.name}{device.is_default ? " (default)" : ""}</option>)}</select></SettingRow>
    <SettingRow title="Speakers" detail="Output device used for incoming voice."><select value={settings.selected_output_device ?? ""} onChange={(event) => void patch({ selected_output_device: event.target.value || null })}><option value="">System default</option>{outputs.map((device) => <option key={device.name} value={device.name}>{device.name}{device.is_default ? " (default)" : ""}</option>)}</select></SettingRow>
    <SettingRow title="Microphone volume" detail="Gain applied before voice processing."><Slider value={settings.input_volume} min={0} max={2} step={0.05} onChange={(value) => void patch({ input_volume: value })} format={(value) => `${Math.round(value * 100)}%`} /></SettingRow>
    <SettingRow title="Speaker volume" detail="Master level for incoming voice."><Slider value={settings.output_volume} min={0} max={2} step={0.05} onChange={(value) => void patch({ output_volume: value })} format={(value) => `${Math.round(value * 100)}%`} /></SettingRow>
    <SettingRow title="Activation mode" detail="Choose automatic voice activity or push-to-talk."><select value={settings.push_to_talk ? "ptt" : "vad"} onChange={(event) => void patch({ push_to_talk: event.target.value === "ptt" })}><option value="vad">Voice activity</option><option value="ptt">Push to talk</option></select></SettingRow>
    {settings.push_to_talk ? <SettingRow title="Push-to-talk shortcut" detail="Global shortcut recognized by the native client."><input value={settings.push_to_talk_key ?? ""} onChange={(event) => void patch({ push_to_talk_key: event.target.value || null })} placeholder="Example: Alt+T" /></SettingRow> : <>
      <SettingRow title="Voice activation threshold" detail="The microphone opens above this level."><Slider value={settings.vad_threshold} min={0} max={1} step={0.01} onChange={(value) => void patch({ vad_threshold: value })} format={(value) => `${Math.round(value * 100)}%`} /></SettingRow>
      <SettingRow title="Automatic input sensitivity" detail="Adapt the threshold to ambient noise."><Toggle label="Automatic input sensitivity" checked={settings.auto_input_sensitivity} onChange={() => void patch({ auto_input_sensitivity: !settings.auto_input_sensitivity })} /></SettingRow>
    </>}
    <SettingRow title="Noise suppression" detail="Remove steady background noise before transmission."><select value={settings.denoiser_algorithm} onChange={(event) => void patch({ denoiser_algorithm: event.target.value as NoiseSuppressionAlgorithm, noise_suppression: event.target.value !== "none" })}>{algorithms.map((algorithm) => <option key={algorithm} value={algorithm}>{NOISE_SUPPRESSION_LABELS[algorithm]}</option>)}</select></SettingRow>
    {paramSpecs.map((spec) => <SettingRow key={spec.id} title={spec.label} detail={spec.description}><Slider value={settings.denoiser_params[spec.id] ?? spec.default} min={spec.min} max={spec.max} step={spec.step} onChange={(value) => void patch({ denoiser_params: { ...settings.denoiser_params, [spec.id]: value } })} format={(value) => `${value}${spec.unit ? ` ${spec.unit}` : ""}`} /></SettingRow>)}
    <SettingRow title="Automatic gain" detail="Normalize quiet and loud microphones."><Toggle label="Automatic gain" checked={settings.auto_gain} onChange={() => void patch({ auto_gain: !settings.auto_gain })} /></SettingRow>
    <SettingRow title="Maximum gain" detail="Upper automatic-gain boost."><Slider value={settings.max_gain_db} min={0} max={30} step={1} onChange={(value) => void patch({ max_gain_db: value })} format={(value) => `${value} dB`} /></SettingRow>
    <SettingRow title="Gate close ratio" detail="How far the signal must fall before transmission closes."><Slider value={settings.noise_gate_close_ratio} min={0.1} max={1} step={0.05} onChange={(value) => void patch({ noise_gate_close_ratio: value })} format={(value) => value.toFixed(2)} /></SettingRow>
    <SettingRow title="Gate hold" detail="How long the voice gate remains open after speech."><Slider value={settings.hold_frames} min={1} max={50} step={1} onChange={(value) => void patch({ hold_frames: value })} format={(value) => `${value} frames`} /></SettingRow>
    <SettingRow title="Voice bitrate" detail="Higher values improve quality and use more bandwidth."><Slider value={settings.bitrate_bps} min={16000} max={128000} step={8000} onChange={(value) => void patch({ bitrate_bps: value })} format={(value) => `${Math.round(value / 1000)} kbps`} /></SettingRow>
    <SettingRow title="Packet duration" detail="Short frames reduce latency; long frames reduce overhead."><select value={settings.frame_size_ms} onChange={(event) => void patch({ frame_size_ms: Number(event.target.value) })}>{[10, 20, 40, 60].map((value) => <option key={value} value={value}>{value} ms</option>)}</select></SettingRow>
    <SettingRow title="Force TCP audio" detail="Tunnel voice through TCP for restrictive networks."><Toggle label="Force TCP audio" checked={settings.force_tcp_audio} onChange={() => void patch({ force_tcp_audio: !settings.force_tcp_audio })} /></SettingRow>
    <SettingRow title="Exclusive microphone" detail="Request exclusive device access on supported systems."><Toggle label="Exclusive microphone" checked={settings.exclusive_input ?? false} onChange={() => void patch({ exclusive_input: !settings.exclusive_input })} /></SettingRow>
    <SettingRow title="Playback backend" detail="Switch the native output implementation; applies on the next voice start."><select value={rodioBackend ? "rodio" : "cpal"} onChange={(event) => { const useRodio = event.target.value === "rodio"; setRodioBackend(useRodio); void invoke("set_audio_backend", { useRodio }); }}><option value="rodio">Rodio (recommended)</option><option value="cpal">CPAL compatibility</option></select></SettingRow>
    <div className={styles.micTest}><div><strong>Microphone test</strong><small>Measure the processed input without transmitting.</small><i><b style={{ width: `${micLevel * 100}%` }} /></i></div><Button onClick={() => void toggleTest()}>{testing ? "Stop test" : "Test microphone"}</Button></div>
    <div className={styles.micTest}><div><strong>Hear your processed voice</strong><small>Record a short sample, then play it back through the selected output device.</small><i><b style={{ width: `${replay.phase === "recording" ? Math.min(100, replay.elapsed_ms / Math.max(1, replay.capacity_ms) * 100) : replay.phase === "playing" ? Math.min(100, replay.elapsed_ms / Math.max(1, replay.total_ms) * 100) : 0}%` }} /></i></div><Button onClick={() => void toggleReplay()}>{replay.phase === "idle" ? "Record sample" : replay.phase === "recording" ? `Stop (${Math.round(replay.elapsed_ms / 1000)}s)` : `Stop playback (${Math.round(replay.elapsed_ms / 1000)}s)`}</Button></div>
    {status && <p className={styles.audioStatus}>{status}</p>}
  </div>;
}
