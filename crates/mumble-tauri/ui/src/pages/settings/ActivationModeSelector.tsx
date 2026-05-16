import type { AudioSettings } from "../../types";
import { ActivityIcon, AudioWaveformIcon, KeyboardIcon } from "../../icons";
import { RadioCardGroup, type RadioCardOption } from "../../components/elements/RadioCardGroup";

type ActivationMode = "voice" | "continuous" | "ptt";

interface ActivationOption extends RadioCardOption<ActivationMode> {
  isActive: (s: AudioSettings) => boolean;
  patch: Partial<AudioSettings>;
}

const ACTIVATION_OPTIONS: ActivationOption[] = [
  {
    value: "voice",
    label: "Voice Activation",
    description:
      "Transmits while you talk. The mic opens when audio crosses the threshold and closes when it drops back below.",
    Icon: ActivityIcon,
    isActive: (s) => !s.push_to_talk && s.noise_suppression,
    patch: { push_to_talk: false, noise_suppression: true },
  },
  {
    value: "continuous",
    label: "Continuous",
    description:
      "Always transmits. Best when you are alone in a quiet room or want zero clipping at the start of words.",
    Icon: AudioWaveformIcon,
    isActive: (s) => !s.push_to_talk && !s.noise_suppression,
    patch: {
      push_to_talk: false,
      noise_suppression: false,
      auto_input_sensitivity: false,
    },
  },
  {
    value: "ptt",
    label: "Push to Talk",
    description:
      "Transmits only while a hotkey is held. Set the key under the Shortcuts tab.",
    Icon: KeyboardIcon,
    isActive: (s) => s.push_to_talk,
    patch: {
      push_to_talk: true,
      noise_suppression: false,
      auto_input_sensitivity: false,
    },
  },
];

export function ActivationModeSelector({
  settings,
  onChange,
}: Readonly<{
  settings: AudioSettings;
  onChange: (patch: Partial<AudioSettings>) => void;
}>) {
  const activeMode =
    ACTIVATION_OPTIONS.find((o) => o.isActive(settings))?.value ?? "voice";

  return (
    <RadioCardGroup
      name="activation_mode"
      options={ACTIVATION_OPTIONS}
      value={activeMode}
      onChange={(mode) => {
        const opt = ACTIVATION_OPTIONS.find((o) => o.value === mode);
        if (opt) onChange(opt.patch);
      }}
    />
  );
}
