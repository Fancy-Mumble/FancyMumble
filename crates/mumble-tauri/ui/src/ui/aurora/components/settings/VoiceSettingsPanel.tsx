import { useAppStore } from "@core/store";
import { Button } from "../primitives";
import SettingsFeatureRow from "./SettingsFeatureRow";
import VoiceAudioSettings from "./VoiceAudioSettings";

export default function VoiceSettingsPanel() {
  const voiceState = useAppStore((state) => state.voiceState);
  return <>
    <SettingsFeatureRow title="Microphone state" detail="Control the native capture pipeline.">
      <Button onClick={() => void (voiceState === "inactive" ? useAppStore.getState().enableVoice() : useAppStore.getState().disableVoice())}>{voiceState === "inactive" ? "Enable voice" : "Disable voice"}</Button>
    </SettingsFeatureRow>
    <SettingsFeatureRow title="Mute microphone" detail="Remain connected to voice without transmitting.">
      <Button disabled={voiceState === "inactive"} onClick={() => void useAppStore.getState().toggleMute()}>{voiceState === "muted" ? "Unmute" : "Mute"}</Button>
    </SettingsFeatureRow>
    <VoiceAudioSettings />
  </>;
}
