import type { UserEntry } from "@core/types";
import { HeadphonesOffIcon, MicOffIcon } from "@ui/icons";
import ChannelPresenceAvatar from "./ChannelPresenceAvatar";
import styles from "./ChannelList.module.css";

export interface ChannelOccupantProps {
  user: UserEntry;
  talking: boolean;
  /** Renders the row as the local user. */
  own?: boolean;
}

/**
 * One person inside a voice channel: who they are and what their mic and
 * output are doing.
 *
 * Server mutes and self mutes are shown identically - from the outside the
 * effect is the same, and the distinction belongs in the profile card.
 */
export default function ChannelOccupant({ user, talking, own }: ChannelOccupantProps) {
  const deafened = user.deaf || user.self_deaf;
  // Deafening also silences your mic, so a deafened user is always muted too
  // and shows both icons - one indicator per thing that is off.
  const muted = user.mute || user.self_mute || user.suppress || deafened;
  const state = deafened ? "Muted and deafened" : muted ? "Muted" : talking ? "Speaking" : "Listening";

  return (
    <span className={`${styles.occupant} ${own ? styles.occupantOwn : ""}`} title={`${user.name} - ${state}`}>
      <ChannelPresenceAvatar name={user.name} talking={talking} />
      <span className={styles.occupantName}>{user.name}</span>
      <span className={styles.occupantState} aria-label={state}>
        {muted && <MicOffIcon className={styles.stateOff} />}
        {deafened && <HeadphonesOffIcon className={styles.stateOff} />}
      </span>
    </span>
  );
}
