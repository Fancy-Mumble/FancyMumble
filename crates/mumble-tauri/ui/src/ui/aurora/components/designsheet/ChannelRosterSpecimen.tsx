import type { UserEntry } from "@core/types";
import { HashIcon, VolumeIcon } from "@ui/icons";
import ChannelPresence from "../channel/ChannelPresence";
import styles from "./ChannelRosterSpecimen.module.css";

/**
 * Voice-channel occupancy as it appears in the channel sidebar.
 *
 * The connected client needs a live server, so this is the only automated
 * regression surface for the roster's speaking / muted / deafened states.
 */
const person = (session: number, name: string, extra: Partial<UserEntry> = {}) =>
  ({
    session,
    name,
    channel_id: 1,
    user_id: session,
    mute: false,
    deaf: false,
    suppress: false,
    self_mute: false,
    self_deaf: false,
    ...extra,
  }) as UserEntry;

const busy = [
  person(1, "carmol92"),
  person(2, "HerrZugbegleiter"),
  person(3, "Mörco", { self_mute: true }),
  person(4, "Oliver", { self_deaf: true }),
  person(5, "Speckbaer_09", { suppress: true }),
];

export default function ChannelRosterSpecimen() {
  return (
    <div className={styles.rail}>
      <button type="button" className={styles.channel}>
        <VolumeIcon />
        <span>Raucher-Ecke</span>
        <b>{busy.length}</b>
      </button>
      <ChannelPresence users={busy} talkingSessions={new Set([2])} ownSession={1} />

      <button type="button" className={styles.channel}>
        <HashIcon />
        <span>Back From Japan</span>
      </button>
      <ChannelPresence users={[person(6, "wanda"), person(7, "chris")]} talkingSessions={new Set()} />

      <button type="button" className={styles.channel}>
        <HashIcon />
        <span>Empty channel</span>
      </button>
      <ChannelPresence users={[]} talkingSessions={new Set()} />
    </div>
  );
}
