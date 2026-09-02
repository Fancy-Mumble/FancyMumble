import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Box, Button, MenuItem, TextField, Typography } from "@mui/material";
import { useAppStore } from "@core/store";
import { getSavedAudioSettings, saveAudioSettings } from "@core/preferencesStorage";
import { isWindows } from "@core/utils/platform";
import {
  NOISE_SUPPRESSION_LABELS,
  type AudioDevice,
  type AudioSettings,
  type CryptoStats,
  type DenoiserParamSpec,
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
  { id: "voice" as const, labelKey: "voice.activationVoice", hintKey: "voice.activationVoiceHint" },
  {
    id: "continuous" as const,
    labelKey: "voice.activationContinuous",
    hintKey: "voice.activationContinuousHint",
  },
  { id: "ptt" as const, labelKey: "voice.activationPtt", hintKey: "voice.activationPttHint" },
] as const;

const ALGORITHMS = Object.keys(NOISE_SUPPRESSION_LABELS) as NoiseSuppressionAlgorithm[];

/**
 * What each algorithm is, in one line under the track.
 *
 * The shared `NOISE_SUPPRESSION_LABELS` carry a parenthetical that names the
 * technique; the mock names the trade-off instead, because that is what the
 * choice is actually between.
 */
const ALGORITHM_HINT_KEYS = {
  none: "voice.hintNone",
  rnnoise: "voice.hintRnnoise",
  deepfilternet: "voice.hintDeepfilternet",
  omlsa_imcra: "voice.hintOmlsa",
  spectral_subtraction: "voice.hintSpectral",
} as const satisfies Record<NoiseSuppressionAlgorithm, string>;

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
  const { t } = useTranslation(["nebulaSettings", "settings"]);
  const voiceState = useAppStore((state) => state.voiceState);
  const { prefs } = usePreferenceSettings();
  const [settings, setSettings] = useState<AudioSettings | null>(null);
  const [inputs, setInputs] = useState<AudioDevice[]>([]);
  const [outputs, setOutputs] = useState<AudioDevice[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  // The backend is asked which denoisers this build actually carries:
  // DeepFilterNet is an optional feature, and a pill that selects an absent
  // algorithm would silently leave the previous one running.
  const [availableAlgorithms, setAvailableAlgorithms] = useState<NoiseSuppressionAlgorithm[] | null>(null);
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
        <PageTitle title={t("settings:audio.panelTitle")} />
        <Typography sx={(theme) => ({ fontSize: 12.5, color: theme.palette.nebula.muted })}>
          {t("nebulaSettings:voice.engineDown")}
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
  const isExpert = prefs !== null && prefs.userMode !== "normal";

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
        title={t("settings:audio.panelTitle")}
        action={
          <Button
            size="small"
            variant="outlined"
            title={
              running
                ? t("nebulaSettings:voice.voiceOnTitle")
                : t("nebulaSettings:voice.voiceOffTitle")
            }
            onClick={() =>
              void (running ? useAppStore.getState().disableVoice() : useAppStore.getState().enableVoice())
            }
          >
            {running ? t("nebulaSettings:voice.turnVoiceOff") : t("nebulaSettings:voice.turnVoiceOn")}
          </Button>
        }
      />

      <Stack direction="row" gap={2.5}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Field label={t("nebulaSettings:voice.inputDevice")}>
            <TextField
              select
              fullWidth
              size="small"
              value={settings.selected_device ?? ""}
              onChange={(event) => patch({ selected_device: event.target.value || null })}
              // Without `displayEmpty` a Select treats the empty value as
              // "nothing chosen" and renders a blank box, so the default
              // device - which is what most people are on - had no name.
              slotProps={{
                select: { displayEmpty: true },
                htmlInput: { "aria-label": t("nebulaSettings:voice.inputDevice") },
              }}
            >
              <MenuItem value="">{t("settings:audio.systemDefault")}</MenuItem>
              {inputs.map((device) => (
                <MenuItem key={device.name} value={device.name}>
                  {device.name}
                </MenuItem>
              ))}
            </TextField>
          </Field>
          <Box sx={{ mt: "14px" }}>
            <SliderRow
              label={t("nebulaSettings:voice.microphoneVolume")}
              value={settings.input_volume}
              display={t("nebulaSettings:voice.percent", {
                value: Math.round(settings.input_volume * 100),
              })}
              min={0}
              max={2}
              step={0.01}
              onChange={(value) => setSettings({ ...settings, input_volume: value })}
              onCommit={(value) => patch({ input_volume: value })}
            />
          </Box>
        </Box>

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Field label={t("nebulaSettings:voice.outputDevice")}>
            <TextField
              select
              fullWidth
              size="small"
              value={settings.selected_output_device ?? ""}
              onChange={(event) => patch({ selected_output_device: event.target.value || null })}
              // Without `displayEmpty` a Select treats the empty value as
              // "nothing chosen" and renders a blank box, so the default
              // device - which is what most people are on - had no name.
              slotProps={{
                select: { displayEmpty: true },
                htmlInput: { "aria-label": t("nebulaSettings:voice.outputDevice") },
              }}
            >
              <MenuItem value="">{t("settings:audio.systemDefault")}</MenuItem>
              {outputs.map((device) => (
                <MenuItem key={device.name} value={device.name}>
                  {device.name}
                </MenuItem>
              ))}
            </TextField>
          </Field>
          <Box sx={{ mt: "14px" }}>
            <SliderRow
              label={t("nebulaSettings:voice.speakerVolume")}
              value={settings.output_volume}
              display={t("nebulaSettings:voice.percent", {
                value: Math.round(settings.output_volume * 100),
              })}
              min={0}
              max={2}
              step={0.01}
              onChange={(value) => setSettings({ ...settings, output_volume: value })}
              onCommit={(value) => patch({ output_volume: value })}
            />
          </Box>
        </Box>
      </Stack>

      {/*
        Exclusive capture is a fact about the *device*, so it sits with the
        device pickers rather than in the expert group: it is the answer to
        "another application has my microphone", which is a problem people
        arrive at this page already having, not a knob to go looking for.
        Windows-only because WASAPI is what has the mode - the backend ignores
        the flag everywhere else.
      */}
      {isWindows && (
        <ToggleCard
          sx={{ mt: "18px" }}
          title={t("settings:audio.exclusiveInput")}
          hint={t("nebulaSettings:voice.exclusiveInputHint")}
          checked={settings.exclusive_input ?? false}
          onChange={() => patch({ exclusive_input: !settings.exclusive_input })}
        />
      )}

      <GroupTitle>{t("nebulaSettings:voice.activationMode")}</GroupTitle>
      <ChoiceCards
        ariaLabel={t("nebulaSettings:voice.activationMode")}
        options={ACTIVATION.map((option) => ({
          id: option.id,
          label: t(option.labelKey),
          hint: t(option.hintKey),
        }))}
        value={activation}
        onChange={setActivation}
      />

      {/*
        The gate only exists in voice-activation mode: continuous never closes
        it and push-to-talk replaces it with a key, so calibrating one there
        tunes something that is not in the path.
      */}
      {activation === "voice" && <VoiceGate settings={settings} onChange={patch} />}

      <GroupTitle space="wide" hint={t("nebulaSettings:voice.processingHint")}>
        {t("nebulaSettings:voice.processing")}
      </GroupTitle>
      <ToggleCard
        title={t("nebulaSettings:voice.autoGain")}
        hint={t("settings:audio.autoGainHint")}
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
              label={t("nebulaSettings:voice.maxAmplification")}
              value={settings.max_gain_db}
              display={t("nebulaSettings:voice.decibels", { value: Math.round(settings.max_gain_db) })}
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
        <ValueHeader
          label={t("nebulaSettings:voice.noiseSuppression")}
          value={algorithmLabel(algorithm)}
        />
      </Box>
      <SegmentedGroup
        ariaLabel={t("nebulaSettings:voice.noiseSuppression")}
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
        {t(ALGORITHM_HINT_KEYS[algorithm])}
      </Typography>

      {/*
        Expert-gated the way Standard gates it: the defaults are tuned, and a
        mistuned denoiser sounds like a broken microphone rather than like a
        setting someone changed.
      */}
      {isExpert && (
        <DenoiserFineTuning
          algorithm={algorithm}
          params={settings.denoiser_params ?? {}}
          onDrag={(denoiser_params) => setSettings({ ...settings, denoiser_params })}
          onCommit={(denoiser_params) => patch({ denoiser_params })}
        />
      )}

      <GroupTitle space="wide" hint={t("nebulaSettings:voice.transmissionHint")}>
        {t("nebulaSettings:voice.transmission")}
      </GroupTitle>
      <SliderRow
        label={t("nebulaSettings:voice.quality")}
        value={settings.bitrate_bps / 1000}
        display={t("nebulaSettings:voice.kbps", { value: Math.round(settings.bitrate_bps / 1000) })}
        min={8}
        max={320}
        step={8}
        onChange={(value) => setSettings({ ...settings, bitrate_bps: value * 1000 })}
        onCommit={(value) => patch({ bitrate_bps: value * 1000 })}
      />

      <Box sx={{ mt: "16px", mb: "8px" }}>
        <ValueHeader
          label={t("nebulaSettings:voice.audioPerPacket")}
          value={t("nebulaSettings:voice.milliseconds", { value: settings.frame_size_ms })}
        />
      </Box>
      <SegmentedGroup
        ariaLabel={t("nebulaSettings:voice.audioPerPacketShort")}
        value={String(settings.frame_size_ms)}
        onChange={(id) => patch({ frame_size_ms: Number(id) })}
        options={FRAME_SIZES.map((ms) => ({
          id: ms,
          label: t("nebulaSettings:voice.milliseconds", { value: ms }),
        }))}
      />

      <ToggleCard
        sx={{ mt: "18px" }}
        title={t("nebulaSettings:voice.forceTcp")}
        hint={t("nebulaSettings:voice.forceTcpHint")}
        checked={settings.force_tcp_audio}
        onChange={() => patch({ force_tcp_audio: !settings.force_tcp_audio })}
      />

      {/*
        Expert mode gates this the way it gates Standard's expert section and
        Nebula's Advanced page: choosing the audio backend can leave capture
        broken in a way the user has no way to connect back to a switch.
      */}
      {isExpert && useRodio !== null && (
        <>
          <GroupTitle space="wide">{t("nebulaSettings:voice.expert")}</GroupTitle>
          <ToggleCard
            title={t("nebulaSettings:voice.legacyBackend")}
            hint={t("nebulaSettings:voice.legacyBackendHint")}
            checked={!useRodio}
            onChange={() => {
              const next = !useRodio;
              setUseRodio(next);
              void invoke("set_audio_backend", { useRodio: next }).catch(() => setUseRodio(!next));
            }}
          />
        </>
      )}

      <GroupTitle space="wide">{t("nebulaSettings:voice.audioStatistics")}</GroupTitle>
      <AudioStats />
    </Box>
  );
}

/**
 * The knobs behind whichever denoiser is running.
 *
 * The schema is asked of the backend rather than written out here: which knobs
 * an algorithm has is a property of the code that implements it, and a table
 * in the UI would go stale the first time one gained a parameter. Algorithms
 * with nothing to tune - "none", RNNoise - answer with an empty list, so the
 * section appears only when it has something in it.
 *
 * Dragging writes to the page's copy and only the released value reaches the
 * engine: every write is an IPC round trip plus a disk write, and a drag is a
 * hundred of them.
 */
function DenoiserFineTuning({
  algorithm,
  params,
  onDrag,
  onCommit,
}: Readonly<{
  algorithm: NoiseSuppressionAlgorithm;
  params: Record<string, number>;
  onDrag: (params: Record<string, number>) => void;
  onCommit: (params: Record<string, number>) => void;
}>) {
  const { t } = useTranslation("nebulaSettings");
  const [specs, setSpecs] = useState<DenoiserParamSpec[]>([]);

  useEffect(() => {
    let active = true;
    void invoke<DenoiserParamSpec[]>("get_denoiser_param_specs", { algorithm })
      .then((fetched) => {
        if (active) setSpecs(Array.isArray(fetched) ? fetched : []);
      })
      .catch(() => {
        if (active) setSpecs([]);
      });
    return () => {
      active = false;
    };
  }, [algorithm]);

  if (specs.length === 0) return null;

  return (
    <Box sx={{ mt: "16px" }}>
      <GroupTitle hint={t("voice.fineTuningHint")}>{t("voice.fineTuning")}</GroupTitle>
      <Stack gap={1.75}>
        {specs.map((spec) => {
          const value = params[spec.id] ?? spec.default;
          return (
            <Box key={spec.id}>
              <SliderRow
                label={spec.label}
                value={value}
                display={formatParam(value, spec.step, spec.unit)}
                min={spec.min}
                max={spec.max}
                step={spec.step}
                onChange={(next) => onDrag({ ...params, [spec.id]: next })}
                onCommit={(next) => onCommit({ ...params, [spec.id]: next })}
              />
              {spec.description && (
                <Typography sx={(theme) => ({ mt: "3px", fontSize: 11, color: theme.palette.nebula.dim })}>
                  {spec.description}
                </Typography>
              )}
            </Box>
          );
        })}
      </Stack>
    </Box>
  );
}

/**
 * A parameter's value, with as many decimals as its step actually resolves.
 *
 * A knob stepping by 0.05 printed as "0.30000000000000004" is the float coming
 * through; one stepping by 1 printed as "12.0" is noise.
 */
function formatParam(value: number, step: number, unit: string): string {
  const decimals = step < 1 ? (String(step).split(".")[1]?.length ?? 2) : 0;
  return `${value.toFixed(Math.min(decimals, 3))}${unit ? ` ${unit}` : ""}`;
}

/**
 * The UDP packet counters for the live connection.
 *
 * Event-fed rather than polled, and rendered only once a frame has arrived:
 * with no connection there are no counters, and zeroes would read as a perfect
 * link rather than as no link at all.
 */
function AudioStats() {
  const { t } = useTranslation(["nebulaSettings", "settings"]);
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
        {t("settings:audio.stats.noStats")}
      </Typography>
    );

  return (
    <>
      <Typography sx={(theme) => ({ mb: "10px", fontSize: 11.5, color: theme.palette.nebula.dim })}>
        {t("settings:audio.stats.udpCounters")}
      </Typography>
      <StatsRow label={t("nebulaSettings:voice.toClient")} stats={stats.to_client} />
      <StatsRow label={t("nebulaSettings:voice.fromClient")} stats={stats.from_client} />
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
