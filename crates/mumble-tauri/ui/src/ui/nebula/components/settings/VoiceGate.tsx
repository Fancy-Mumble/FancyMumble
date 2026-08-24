import { Box, Typography } from "@mui/material";
import type { AudioSettings } from "@core/types";
import { VuMeter, type VuMarker } from "@standard/pages/settings/VuMeter";
import {
  REPLAY_CAPACITY_MS,
  SPEECH_TARGET_MS,
  replayProgress,
  useVoiceCalibration,
} from "@standard/pages/settings/useVoiceCalibration";
import { Stack } from "../primitives";
import { ChoiceCards, GroupTitle, SliderRow } from "./controls";
import { radius } from "../../tokens";

type Mode = "auto" | "manual";

const MODES = [
  {
    id: "auto" as const,
    label: "Auto calibrate",
    hint: "Speak ~5 s; threshold, hysteresis and hold tune themselves.",
  },
  {
    id: "manual" as const,
    label: "Manual calibrate",
    hint: "Drag Open and Close markers directly on the meter.",
  },
];

/**
 * The voice gate: how it is tuned, and proof that it is.
 *
 * Standard draws this too, and the two draw nothing alike - so what is shared
 * is `useVoiceCalibration`, which owns the mic test, the level stream, the
 * speech timer, the calibrator's answer and the replay recorder. This file is
 * only the mock.
 *
 * The VU meter itself stays Standard's. It is a measurement widget with a dB
 * axis and draggable markers, it already draws from the active colour theme,
 * and a second one would be a second set of numbers to keep honest.
 */
export function VoiceGate({
  settings,
  onChange,
}: Readonly<{
  settings: AudioSettings;
  onChange: (patch: Partial<AudioSettings>) => void;
}>) {
  const gate = useVoiceCalibration(settings, onChange);
  const mode: Mode = settings.auto_input_sensitivity ? "auto" : "manual";

  return (
    <>
      <GroupTitle>Voice gate</GroupTitle>
      <ChoiceCards
        ariaLabel="Voice gate"
        options={MODES}
        value={mode}
        onChange={(next) => onChange({ auto_input_sensitivity: next === "auto" })}
      />

      {mode === "auto" ? (
        <AutoGate settings={settings} gate={gate} />
      ) : (
        <ManualGate settings={settings} onChange={onChange} gate={gate} />
      )}

      <Stack
        direction="row"
        gap={1.75}
        flexWrap="wrap"
        sx={(theme) => ({ mt: "10px", fontSize: 10.5, color: theme.palette.nebula.dim })}
      >
        <span>threshold {(settings.vad_threshold * 100).toFixed(1)}%</span>
        <span>close {Math.round(settings.noise_gate_close_ratio * 100)}%</span>
        <span>hold {settings.hold_frames} frames</span>
        <span>max gain {settings.max_gain_db.toFixed(1)} dB</span>
      </Stack>

      <HearYourself gate={gate} />
    </>
  );
}

type Gate = ReturnType<typeof useVoiceCalibration>;

/**
 * The calibrate action, and what it is asking for.
 *
 * One row in three states - never calibrated, calibrated, listening - rather
 * than a banner that appears and shoves the button down the page: the button is
 * in the same place throughout, which is where the user's pointer already is
 * when the five seconds end.
 */
function AutoGate({ settings, gate }: Readonly<{ settings: AudioSettings; gate: Gate }>) {
  const needed = !gate.hasCalibrated && !gate.testing;
  const seconds = (gate.speechProgress * (SPEECH_TARGET_MS / 1000)).toFixed(1);

  const [title, hint] = gate.testing
    ? [
        gate.speechProgress >= 1 ? "That's enough — stop when you like" : "Listening…",
        gate.speaking ? `Speaking · ${seconds} / 5.0 s` : `Silent · ${seconds} / 5.0 s`,
      ]
    : needed
      ? ["Calibration needed", "Speak naturally for 5 seconds so the gate tunes itself to your mic."]
      : ["Gate calibrated", "Run it again if you change microphone, room or filters."];

  return (
    <>
      <Stack
        direction="row"
        alignItems="center"
        gap={1.5}
        sx={(theme) => ({
          mt: "16px",
          px: "14px",
          py: "11px",
          borderRadius: radius("md"),
          background: theme.palette.nebula.card,
          border: `1px solid ${theme.palette.nebula.line}`,
        })}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography
            sx={(theme) => ({
              fontSize: 12,
              fontWeight: 600,
              color: needed ? theme.palette.nebula.warn : theme.palette.nebula.text,
            })}
          >
            {title}
          </Typography>
          <Typography sx={(theme) => ({ fontSize: 11, color: theme.palette.nebula.muted })}>
            {hint}
          </Typography>
        </Box>
        <GateButton primary={!gate.testing} onClick={gate.toggleTest}>
          {gate.testing ? "Stop" : needed ? "Calibrate" : "Recalibrate"}
        </GateButton>
      </Stack>

      {gate.testing && (
        <>
          <Box
            sx={(theme) => ({
              mt: "10px",
              height: 4,
              borderRadius: "999px",
              background: theme.palette.nebula.card2,
            })}
          >
            <Box
              sx={(theme) => ({
                width: `${gate.speechProgress * 100}%`,
                height: "100%",
                borderRadius: "999px",
                background: theme.palette.nebula.accent,
                transition: "width 120ms linear",
              })}
            />
          </Box>
          <Box sx={{ mt: "6px" }}>
            <VuMeter
              rms={gate.rms}
              peak={gate.peak}
              talking={gate.talking}
              markers={openCloseMarkers(settings)}
            />
          </Box>
        </>
      )}
    </>
  );
}

/**
 * The gate set by hand, on the meter it is set against.
 *
 * The markers carry their own `onChange`, so dragging one writes the threshold
 * directly - the mock's "drag Open and Close markers directly on the meter",
 * rather than two number fields beside a picture of the thing they describe.
 */
function ManualGate({
  settings,
  onChange,
  gate,
}: Readonly<{
  settings: AudioSettings;
  onChange: (patch: Partial<AudioSettings>) => void;
  gate: Gate;
}>) {
  const close = settings.vad_threshold * settings.noise_gate_close_ratio;

  const markers: VuMarker[] = [
    {
      ...openCloseMarkers(settings)[0],
      onChange: (next) => onChange({ vad_threshold: next }),
      ariaLabel: "Open threshold",
    },
    {
      ...openCloseMarkers(settings)[1],
      onChange: (next) => {
        // The close level is stored as a ratio of the open one, so a marker
        // dragged above Open would otherwise be saved as a ratio over 1 and
        // silently clamp somewhere else.
        const open = Math.max(settings.vad_threshold, next + 1e-4);
        onChange({ noise_gate_close_ratio: Math.min(0.99, Math.max(0.1, next / open)) });
      },
      ariaLabel: "Close threshold",
    },
  ];

  return (
    <Box
      sx={(theme) => ({
        mt: "16px",
        px: "14px",
        py: "13px",
        borderRadius: radius("md"),
        background: theme.palette.nebula.card,
        border: `1px solid ${theme.palette.nebula.line}`,
      })}
    >
      <Typography sx={(theme) => ({ fontSize: 11, lineHeight: 1.5, color: theme.palette.nebula.muted })}>
        Transmission starts above <GateWord tone="open">Open</GateWord> and stops below{" "}
        <GateWord tone="close">Close</GateWord>, so a pause between words does not cut you off.
      </Typography>

      <Box sx={{ mt: "4px" }}>
        <VuMeter rms={gate.rms} peak={gate.peak} talking={gate.talking} markers={markers} />
      </Box>

      <Stack direction="row" alignItems="center" gap={1.5} sx={{ mt: "4px" }}>
        <Typography sx={(theme) => ({ flex: 1, fontSize: 11, color: theme.palette.nebula.muted })}>
          {gate.testing
            ? gate.talking
              ? `Transmitting now · open ${(settings.vad_threshold * 100).toFixed(1)}% · close ${(close * 100).toFixed(1)}%`
              : "Below the threshold — nothing is being sent."
            : "Start the meter to see where your voice sits against the markers."}
        </Typography>
        <GateButton primary={!gate.testing} onClick={gate.toggleTest}>
          {gate.testing ? "Stop" : "Test microphone"}
        </GateButton>
      </Stack>

      <Box sx={{ mt: "12px" }}>
        <SliderRow
          label="Hold — how long the gate stays open after you stop"
          value={settings.hold_frames}
          display={`${settings.hold_frames} frames`}
          min={1}
          max={50}
          step={1}
          onChange={(value) => onChange({ hold_frames: value })}
        />
      </Box>
    </Box>
  );
}

/** The replay recorder, drawn as the mock's card rather than a bare button. */
function HearYourself({ gate }: Readonly<{ gate: Gate }>) {
  const { replay } = gate;
  const active = replay.phase !== "idle";
  const label =
    replay.phase === "idle"
      ? "Record sample"
      : replay.phase === "recording"
        ? `Stop recording · ${Math.round(replay.elapsed_ms / 1000)} / ${Math.round(replay.capacity_ms / 1000)} s`
        : `Stop playback · ${Math.round(replay.elapsed_ms / 1000)} / ${Math.round(replay.total_ms / 1000)} s`;

  return (
    <Box
      sx={(theme) => ({
        mt: "20px",
        px: "14px",
        py: "13px",
        borderRadius: radius("md"),
        background: theme.palette.nebula.card,
        border: `1px solid ${theme.palette.nebula.line}`,
      })}
    >
      <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>Hear yourself</Typography>
      <Typography
        sx={(theme) => ({
          my: "4px",
          mb: "10px",
          fontSize: 11,
          lineHeight: 1.5,
          color: theme.palette.nebula.muted,
        })}
      >
        Record up to {REPLAY_CAPACITY_MS / 1000} s through the same filters your listeners receive, then play
        it back.
      </Typography>
      <Box
        component="button"
        onClick={gate.toggleReplay}
        sx={(theme) => ({
          all: "unset",
          position: "relative",
          overflow: "hidden",
          // `flex` with a fitted width, not `inline-flex`: an inline box sits
          // on the text baseline and leaves a descender's worth of empty card
          // under it.
          display: "flex",
          width: "fit-content",
          cursor: "pointer",
          px: "16px",
          py: "7px",
          borderRadius: radius("sm"),
          background: theme.palette.nebula.card2,
          fontSize: 12,
          fontWeight: 500,
          "&:hover": { background: theme.palette.nebula.hover },
        })}
      >
        {active && (
          <Box
            aria-hidden
            sx={(theme) => ({
              position: "absolute",
              inset: 0,
              right: "auto",
              width: `${Math.min(100, Math.max(0, replayProgress(replay) * 100))}%`,
              background:
                replay.phase === "recording" ? theme.palette.nebula.bad : theme.palette.nebula.accent,
              opacity: 0.35,
              transition: "width 120ms linear",
            })}
          />
        )}
        <Box component="span" sx={{ position: "relative" }}>
          {label}
        </Box>
      </Box>
    </Box>
  );
}

/** The two thresholds, as the meter wants them: absolute, and named. */
function openCloseMarkers(settings: AudioSettings): [VuMarker, VuMarker] {
  const close = settings.vad_threshold * settings.noise_gate_close_ratio;
  return [
    {
      value: settings.vad_threshold,
      variant: "open",
      title: `Open ${(settings.vad_threshold * 100).toFixed(1)}%`,
    },
    { value: close, variant: "close", title: `Close ${(close * 100).toFixed(1)}%` },
  ];
}

/** Names a marker in running text in the colour it is drawn on the meter. */
function GateWord({ tone, children }: Readonly<{ tone: "open" | "close"; children: string }>) {
  return (
    <Box
      component="span"
      sx={(theme) => ({
        fontWeight: 600,
        color: tone === "open" ? theme.palette.nebula.ok : theme.palette.nebula.warn,
      })}
    >
      {children}
    </Box>
  );
}

/** The mock's two button weights: accent for the action, card for stopping it. */
function GateButton({
  primary,
  onClick,
  children,
}: Readonly<{ primary: boolean; onClick: () => void; children: string }>) {
  return (
    <Box
      component="button"
      onClick={onClick}
      sx={(theme) => ({
        all: "unset",
        cursor: "pointer",
        flex: "none",
        ml: "auto",
        px: "15px",
        py: "7px",
        borderRadius: radius("sm"),
        fontSize: 12,
        fontWeight: 500,
        whiteSpace: "nowrap",
        background: primary ? theme.palette.nebula.accent : theme.palette.nebula.card2,
        color: primary ? "#fff" : theme.palette.nebula.text,
        "&:hover": { background: primary ? theme.palette.nebula.accent : theme.palette.nebula.hover },
      })}
    >
      {children}
    </Box>
  );
}
