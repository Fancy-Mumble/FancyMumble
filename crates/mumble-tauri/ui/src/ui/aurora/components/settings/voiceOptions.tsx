import type { NoiseSuppressionAlgorithm } from "@core/types";
import { CommandIcon, MicIcon } from "@ui/icons";
import type { SettingsOption, SettingsRadioOption } from "./layout";

/**
 * Copy for the voice option cards.
 *
 * Split out of the panel because the descriptions are the substance of the
 * choice - "RNNoise" and "OMLSA + IMCRA" mean nothing without them - and the
 * panel is long enough already.
 */
export const ACTIVATION_OPTIONS: readonly SettingsOption<"vad" | "ptt">[] = [
  {
    value: "vad",
    label: "Voice activation",
    description:
      "Transmits while you talk. The mic opens when audio crosses the threshold and closes when it drops back below.",
    icon: <MicIcon />,
  },
  {
    value: "ptt",
    label: "Push to talk",
    description: "Transmits only while a hotkey is held.",
    icon: <CommandIcon />,
  },
];

export const FRAME_SIZE_OPTIONS: readonly SettingsRadioOption<number>[] = [
  { value: 10, label: "10 ms" },
  { value: 20, label: "20 ms" },
  { value: 40, label: "40 ms" },
  { value: 60, label: "60 ms" },
];

/** Keyed loosely so an algorithm the backend adds later still renders. */
export const DENOISER_DESCRIPTIONS: Partial<Record<NoiseSuppressionAlgorithm, string>> = {
  none: "No noise processing. Raw microphone audio is transmitted as-is.",
  rnnoise: "Neural network trained on real speech. Works well in most environments.",
  deepfilternet: "Deep-learning model. Strongest suppression, heaviest on the CPU.",
  omlsa_imcra: "Modern classical estimator. Very smooth suppression output.",
  spectral_subtraction: "Lightest option. Ideal for steady background noise.",
};
