import { useAppStore } from "@core/store";
import { Button } from "../primitives";
import { SettingsGroup, SettingsRow } from "./layout";
import VoiceAudioSettings from "./VoiceAudioSettings";

/** Voice: the live pipeline controls first, then everything that configures it. */
export default function VoiceSettingsPanel() {
  const voiceState = useAppStore((state) => state.voiceState);
  return (
    <>
      <SettingsGroup title="Right now" description="Affects the running client immediately.">
        <SettingsRow title="Microphone state" detail="Control the native capture pipeline.">
          <Button
            onClick={() =>
              void (voiceState === "inactive"
                ? useAppStore.getState().enableVoice()
                : useAppStore.getState().disableVoice())
            }
          >
            {voiceState === "inactive" ? "Enable voice" : "Disable voice"}
          </Button>
        </SettingsRow>
        <SettingsRow title="Mute microphone" detail="Remain connected to voice without transmitting.">
          <Button
            disabled={voiceState === "inactive"}
            onClick={() => void useAppStore.getState().toggleMute()}
          >
            {voiceState === "muted" ? "Unmute" : "Mute"}
          </Button>
        </SettingsRow>
      </SettingsGroup>
      <VoiceAudioSettings />
    </>
  );
}
