import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Box, Button, MenuItem, TextField, Typography } from "@mui/material";
import { useAppStore } from "@core/store";
import { getSavedAudioSettings, saveAudioSettings } from "@core/preferencesStorage";
import {
  NOISE_SUPPRESSION_LABELS,
  type AudioDevice,
  type AudioSettings,
  type CryptoStats,
  type NoiseSuppressionAlgorithm,
  type PacketStats,
} from "@core/types";
import { Stack } from "../primitives";
import {
  ChoiceCards,
  Field,
  GroupTitle,
  PageTitle,
  SegmentedGroup,
  SliderRow,
  ToggleCard,
  ValueHeader,
} from "./controls";
import { usePreferenceSettings } from "./usePreferenceSettings";
import { VoiceGate } from "./VoiceGate";

type Activation = "voice" | "continuous" | "ptt";

const ACTIVATION = [
  { id: "voice" as const, label: "Voice activation", hint: "Transmits while you talk." },
  { id: "continuous" as const, label: "Continuous", hint: "Always transmits." },
  { id: "ptt" as const, label: "Push to talk", hint: "Only while a key is held." },
];

const ALGORITHMS = Object.keys(NOISE_SUPPRESSION_LABELS) as NoiseSuppressionAlgorithm[];

/**
 * What each algorithm is, in one line under the track.
 *
 * The shared `NOISE_SUPPRESSION_LABELS` carry a parenthetical that names the
 * technique; the mock names the trade-off instead, because that is what the
 * choice is actually between.
 */
const ALGORITHM_HINTS: Record<NoiseSuppressionAlgorithm, string> = {
  none: "No processing — the microphone is sent as it is heard.",
  rnnoise: "Neural network trained on real speech — works well in most environments.",
  deepfilternet: "State-of-the-art deep learning. Best quality, highest CPU cost.",
  omlsa_imcra: "Modern classical estimator — very smooth suppression.",
  spectral_subtraction: "The lightest option, and the best on steady background noise.",
};

/** Opus packet lengths the encoder accepts. */
const FRAME_SIZES = ["10", "20", "40", "60"] as const;

/** The pill label, without the parenthetical the dropdown form carries. */
const algorithmLabel = (id: NoiseSuppressionAlgorithm) =>
  NOISE_SUPPRESSION_LABELS[id].replace(/\s*\(.*\)$/, "");

/**
 * The Voice page.
 *
 * Everything writes through the same two calls Standard uses - `set_audio_settings`
 * for the live engine and `saveAudioSettings` for the next launch - so the
 * capture chain behaves identically whichever design made the change.
 *
 * The page is ordered by where in the chain a control acts: what the microphone
 * is, when it opens, how it is tuned, what happens to the signal here, and what
 * leaves for the server. The mock's headings say so out loud, and the chapter
 * ones are set wide apart because those are four different subjects rather than
 * four groups of one.
 */
export function VoiceSettings() {
  const voiceState = useAppStore((state) => state.voiceState);
  const { prefs } = usePreferenceSettings();
  const [settings, setSettings] = useState<AudioSettings | null>(null);
  const [inputs, setInputs] = useState<AudioDevice[]>([]);
  const [outputs, setOutputs] = useState<AudioDevice[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  // The backend is asked which denoisers this build actually carries:
  // DeepFilterNet is an optional feature, and a pill that selects an absent
  // algorithm would silently leave the previous one running.
  const [availableAlgorithms, setAvailableAlgorithms] = useState<NoiseSuppressionAlgorithm[] | null>(
    null,
  );
  // `null` while unknown, so the Expert switch is not drawn in the wrong
  // position for a frame before the backend answers.
  const [useRodio, setUseRodio] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [live, saved, inputDevices, outputDevices] = await Promise.all([
        invoke<AudioSettings>("get_audio_settings"),
        getSavedAudioSettings().catch(() => null),
        invoke<AudioDevice[]>("get_audio_devices").catch(() => []),
        invoke<AudioDevice[]>("get_output_devices").catch(() => []),
      ]);
      if (!active) return;
      setSettings({ ...live, ...(saved ?? {}) });
      setInputs(inputDevices);
      setOutputs(outputDevices);
    })().catch(() => {
      // Every control here writes straight to the capture engine, so with no
      // engine there is nothing to render but an explanation.
      if (active) setUnavailable(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void invoke<NoiseSuppressionAlgorithm[]>("get_available_denoiser_algorithms")
      .then((algorithms) => {
        if (active && Array.isArray(algorithms)) setAvailableAlgorithms(algorithms);
      })
      .catch(() => undefined);
    void invoke<boolean>("get_audio_backend")
      .then((rodio) => {
        if (active) setUseRodio(rodio);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  if (unavailable)
    return (
      <Box sx={{ maxWidth: 640 }}>
        <PageTitle title="Voice" />
        <Typography sx={(theme) => ({ fontSize: 12.5, color: theme.palette.nebula.muted })}>
          The audio engine is not responding, so voice settings cannot be read or changed right now.
        </Typography>
      </Box>
    );
  if (!settings) return null;

  const patch = (changes: Partial<AudioSettings>) => {
    const next = { ...settings, ...changes };
    setSettings(next);
    void invoke("set_audio_settings", { settings: next }).catch(() => undefined);
    void saveAudioSettings(next).catch(() => undefined);
  };

  // The engine has two independent flags, but users think in one choice, so the
  // page presents three modes and maps them back onto the pair.
  const activation: Activation = settings.push_to_talk
    ? "ptt"
    : settings.vad_threshold <= 0
      ? "continuous"
      : "voice";
  const setActivation = (mode: Activation) =>
    patch({
      push_to_talk: mode === "ptt",
      vad_threshold: mode === "continuous" ? 0 : settings.vad_threshold || 0.02,
    });

  const algorithm: NoiseSuppressionAlgorithm = settings.noise_suppression
    ? settings.denoiser_algorithm
    : "none";
  // "none" is how the row is switched off rather than an algorithm the backend
  // has to carry, so it stays on offer whatever the probe says.
  const algorithms = ALGORITHMS.filter(
    (id) => id === "none" || availableAlgorithms === null || availableAlgorithms.includes(id),
  );

  const running = voiceState !== "inactive";

  return (
    <Box sx={{ maxWidth: 640 }}>
      {/*
        Turning voice off is the one voice control that is not a saved setting -
        it stops the running capture engine and clears `voiceOnReconnect`. It
        lives here because the sidebar dock's buttons are mute and deafen, and
        its "Leave" means leaving the server; and it sits on the title rather
        than above the devices, because it switches the whole page off rather
        than being the first of the settings on it.
      */}
      <PageTitle
        title="Voice"
        action={
          <Button
            size="small"
            variant="outlined"
            title={
              running
                ? "Stops capture and playback. Stays off across reconnects."
                : "You are neither transmitting nor receiving while voice is off."
            }
            onClick={() =>
              void (running
                ? useAppStore.getState().disableVoice()
                : useAppStore.getState().enableVoice())
            }
          >
            {running ? "Turn voice off" : "Turn voice on"}
          </Button>
        }
      />

      <Stack direction="row" gap={2.5}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Field label="Input device">
            <TextField
              select
              fullWidth
              size="small"
              value={settings.selected_device ?? ""}
              onChange={(event) => patch({ selected_device: event.target.value || null })}
              // Without `displayEmpty` a Select treats the empty value as
              // "nothing chosen" and renders a blank box, so the default
              // device - which is what most people are on - had no name.
              slotProps={{ select: { displayEmpty: true }, htmlInput: { "aria-label": "Input device" } }}
            >
              <MenuItem value="">System default</MenuItem>
              {inputs.map((device) => (
                <MenuItem key={device.name} value={device.name}>
                  {device.name}
                </MenuItem>
              ))}
            </TextField>
          </Field>
          <Box sx={{ mt: "14px" }}>
            <SliderRow
              label="Microphone volume"
              value={settings.input_volume}
              display={`${Math.round(settings.input_volume * 100)}%`}
              min={0}
              max={2}
              step={0.01}
              onChange={(value) => setSettings({ ...settings, input_volume: value })}
              onCommit={(value) => patch({ input_volume: value })}
            />
          </Box>
        </Box>

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Field label="Output device">
            <TextField
              select
              fullWidth
              size="small"
              value={settings.selected_output_device ?? ""}
              onChange={(event) => patch({ selected_output_device: event.target.value || null })}
              // Without `displayEmpty` a Select treats the empty value as
              // "nothing chosen" and renders a blank box, so the default
              // device - which is what most people are on - had no name.
              slotProps={{ select: { displayEmpty: true }, htmlInput: { "aria-label": "Output device" } }}
            >
              <MenuItem value="">System default</MenuItem>
              {outputs.map((device) => (
                <MenuItem key={device.name} value={device.name}>
                  {device.name}
                </MenuItem>
              ))}
            </TextField>
          </Field>
          <Box sx={{ mt: "14px" }}>
            <SliderRow
              label="Speaker volume"
              value={settings.output_volume}
              display={`${Math.round(settings.output_volume * 100)}%`}
              min={0}
              max={2}
              step={0.01}
              onChange={(value) => setSettings({ ...settings, output_volume: value })}
              onCommit={(value) => patch({ output_volume: value })}
            />
          </Box>
        </Box>
      </Stack>

      <GroupTitle>Activation mode</GroupTitle>
      <ChoiceCards
        ariaLabel="Activation mode"
        options={ACTIVATION}
        value={activation}
        onChange={setActivation}
      />

      {/*
        The gate only exists in voice-activation mode: continuous never closes
        it and push-to-talk replaces it with a key, so calibrating one there
        tunes something that is not in the path.
      */}
      {activation === "voice" && <VoiceGate settings={settings} onChange={patch} />}

      <GroupTitle space="wide" hint="What happens to your voice before it leaves your machine.">
        Processing
      </GroupTitle>
      <ToggleCard
        title="Auto gain"
        hint="Automatically adjusts microphone volume for consistent levels."
        checked={settings.auto_gain}
        onChange={() => patch({ auto_gain: !settings.auto_gain })}
      >
        {/*
          Auto calibration picks the threshold with the ceiling already in hand,
          so the slider is only a decision to make while the gate is tuned by
          hand - the same rule Standard applies.
        */}
        {settings.auto_gain && !settings.auto_input_sensitivity && (
          <Box sx={{ mt: "10px" }}>
            <SliderRow
              label="Max amplification"
              value={settings.max_gain_db}
              display={`${Math.round(settings.max_gain_db)} dB`}
              min={1}
              max={40}
              step={1}
              onChange={(value) => setSettings({ ...settings, max_gain_db: value })}
              onCommit={(value) => patch({ max_gain_db: value })}
            />
          </Box>
        )}
      </ToggleCard>

      <Box sx={{ mt: "18px", mb: "8px" }}>
        <ValueHeader label="Noise suppression" value={algorithmLabel(algorithm)} />
      </Box>
      <SegmentedGroup
        ariaLabel="Noise suppression"
        value={algorithm}
        onChange={(id) =>
          patch(
            id === "none"
              ? { noise_suppression: false }
              : { noise_suppression: true, denoiser_algorithm: id },
          )
        }
        options={algorithms.map((id) => ({ id, label: algorithmLabel(id) }))}
      />
      <Typography sx={(theme) => ({ mt: "8px", fontSize: 11, color: theme.palette.nebula.dim })}>
        {ALGORITHM_HINTS[algorithm]}
      </Typography>

      <GroupTitle space="wide" hint="How your voice travels to the server.">
        Transmission
      </GroupTitle>
      <SliderRow
        label="Quality — higher bitrate means better audio, more bandwidth"
        value={settings.bitrate_bps / 1000}
        display={`${Math.round(settings.bitrate_bps / 1000)} kb/s`}
        min={8}
        max={320}
        step={8}
        onChange={(value) => setSettings({ ...settings, bitrate_bps: value * 1000 })}
        onCommit={(value) => patch({ bitrate_bps: value * 1000 })}
      />

      <Box sx={{ mt: "16px", mb: "8px" }}>
        <ValueHeader
          label="Audio per packet — smaller is lower latency, larger saves bandwidth"
          value={`${settings.frame_size_ms} ms`}
        />
      </Box>
      <SegmentedGroup
        ariaLabel="Audio per packet"
        value={String(settings.frame_size_ms)}
        onChange={(id) => patch({ frame_size_ms: Number(id) })}
        options={FRAME_SIZES.map((ms) => ({ id: ms, label: `${ms} ms` }))}
      />

      <ToggleCard
        sx={{ mt: "18px" }}
        title="Force TCP audio"
        hint="Send audio over the TCP tunnel instead of UDP — for strict firewalls or NAT that blocks UDP."
        checked={settings.force_tcp_audio}
        onChange={() => patch({ force_tcp_audio: !settings.force_tcp_audio })}
      />

      {/*
        Expert mode gates this the way it gates Standard's expert section and
        Nebula's Advanced page: choosing the audio backend can leave capture
        broken in a way the user has no way to connect back to a switch.
      */}
      {prefs !== null && prefs.userMode !== "normal" && useRodio !== null && (
        <>
          <GroupTitle space="wide">Expert</GroupTitle>
          <ToggleCard
            title="Legacy audio backend"
            hint="Switch to the legacy cpal backend if the default rodio backend misbehaves. Takes effect on the next voice toggle."
            checked={!useRodio}
            onChange={() => {
              const next = !useRodio;
              setUseRodio(next);
              void invoke("set_audio_backend", { useRodio: next }).catch(() => setUseRodio(!next));
            }}
          />
        </>
      )}

      <GroupTitle space="wide">Audio statistics</GroupTitle>
      <AudioStats />
    </Box>
  );
}

/**
 * The UDP packet counters for the live connection.
 *
 * Event-fed rather than polled, and rendered only once a frame has arrived:
 * with no connection there are no counters, and zeroes would read as a perfect
 * link rather than as no link at all.
 */
function AudioStats() {
  const [stats, setStats] = useState<CryptoStats | null>(null);

  useEffect(() => {
    const unlisten = listen<CryptoStats>("crypto-stats", (event) => setStats(event.payload));
    return () => {
      void unlisten.then((off) => off());
    };
  }, []);

  if (!stats)
    return (
      <Typography sx={(theme) => ({ pb: "8px", fontSize: 11.5, color: theme.palette.nebula.dim })}>
        No statistics available. Connect to a server to see packet statistics.
      </Typography>
    );

  return (
    <>
      <Typography sx={(theme) => ({ mb: "10px", fontSize: 11.5, color: theme.palette.nebula.dim })}>
        UDP packet counters since connection start.
      </Typography>
      <StatsRow label="To client" stats={stats.to_client} />
      <StatsRow label="From client" stats={stats.from_client} />
    </>
  );
}

function StatsRow({ label, stats }: Readonly<{ label: string; stats: PacketStats }>) {
  const total = stats.good + stats.late + stats.lost;
  const loss = total > 0 ? ((stats.lost / total) * 100).toFixed(1) : "0.0";
  return (
    <Stack
      direction="row"
      justifyContent="space-between"
      gap={2}
      sx={(theme) => ({ py: "5px", fontSize: 11.5, color: theme.palette.nebula.muted })}
    >
      <span>{label}</span>
      <span>
        {stats.good} good · {stats.late} late · {stats.lost} lost ({loss}%) · {stats.resync} resync
      </span>
    </Stack>
  );
}
