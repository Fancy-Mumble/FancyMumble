import { useAppStore } from "@core/store";
import { selectMicLive, selectSelfDeafened } from "@core/store/voiceSelectors";
import { HeadphonesIcon, HeadphonesOffIcon, MicIcon, MicOffIcon } from "@ui/icons";
import { IconButton } from "../primitives";
import styles from "../../AuroraClientApp.module.css";

/**
 * The local user's mic and deafen toggles.
 *
 * Both indicators read the shared voice selectors rather than deriving state
 * here: the mic reflects whether capture is actually live (so voice being off
 * never shows a live mic), and deafen comes from the server-confirmed
 * `self_deaf` flag, which `voiceState` does not carry.
 */
export default function SelfVoiceControls() {
  const micLive = useAppStore(selectMicLive);
  const deafened = useAppStore(selectSelfDeafened);
  const voiceState = useAppStore((state) => state.voiceState);

  return <>
    <IconButton
      icon={micLive ? <MicIcon /> : <MicOffIcon />}
      label={micLive ? "Mute" : voiceState === "inactive" ? "Enable voice" : "Unmute"}
      className={micLive ? undefined : styles.controlActive}
      onClick={() => void (voiceState === "inactive" ? useAppStore.getState().enableVoice() : useAppStore.getState().toggleMute())}
    />
    <IconButton
      icon={deafened ? <HeadphonesOffIcon /> : <HeadphonesIcon />}
      label={deafened ? "Undeafen" : "Deafen"}
      className={deafened ? styles.controlActive : undefined}
      onClick={() => void useAppStore.getState().toggleDeafen()}
    />
  </>;
}
