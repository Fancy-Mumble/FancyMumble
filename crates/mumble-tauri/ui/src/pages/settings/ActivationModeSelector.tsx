import { useTranslation } from "react-i18next";
import type { AudioSettings } from "../../types";
import { ActivityIcon, AudioWaveformIcon, KeyboardIcon } from "../../icons";
import { RadioCardGroup, type RadioCardOption } from "../../components/elements/RadioCardGroup";

type ActivationMode = "voice" | "continuous" | "ptt";

interface ActivationOption extends RadioCardOption<ActivationMode> {
  isActive: (s: AudioSettings) => boolean;
  patch: Partial<AudioSettings>;
}

const ACTIVATION_PATCHES: Array<{
  value: ActivationMode;
  Icon: typeof ActivityIcon;
  isActive: (s: AudioSettings) => boolean;
  patch: Partial<AudioSettings>;
}> = [
  {
    value: "voice",
    Icon: ActivityIcon,
    isActive: (s) => !s.push_to_talk && s.noise_suppression,
    patch: { push_to_talk: false, noise_suppression: true },
  },
  {
    value: "continuous",
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
  const { t } = useTranslation("settings");
  const tStr = t as (key: string) => string;

  const options: ActivationOption[] = ACTIVATION_PATCHES.map((p) => ({
    value: p.value,
    label: tStr(`activation.${p.value}`),
    description: tStr(`activation.${p.value}Desc`),
    Icon: p.Icon,
    isActive: p.isActive,
    patch: p.patch,
  }));

  const activeMode = options.find((o) => o.isActive(settings))?.value ?? "voice";

  return (
    <RadioCardGroup
      name="activation_mode"
      options={options}
      value={activeMode}
      onChange={(mode) => {
        const opt = options.find((o) => o.value === mode);
        if (opt) onChange(opt.patch);
      }}
    />
  );
}
