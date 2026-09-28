import type { UserEntry } from "@core/types";
import ChannelOccupant from "./ChannelOccupant";
import styles from "./ChannelList.module.css";

export interface ChannelPresenceProps {
  users: UserEntry[];
  talkingSessions: ReadonlySet<number>;
  ownSession?: number | null;
}

/**
 * Everyone currently in a voice channel, listed under it.
 *
 * A stacked avatar row made it impossible to tell who was in a channel or what
 * their mic was doing, so each occupant gets a full row instead. Speakers sort
 * to the top so the person talking is always visible without scanning.
 */
export default function ChannelPresence({ users, talkingSessions, ownSession }: ChannelPresenceProps) {
  if (users.length === 0) return null;
  const ordered = [...users].sort(
    (left, right) =>
      Number(talkingSessions.has(right.session)) - Number(talkingSessions.has(left.session)) ||
      left.name.localeCompare(right.name),
  );
  return (
    <span className={styles.occupants}>
      {ordered.map((user) => (
        <ChannelOccupant
          key={user.session}
          user={user}
          talking={talkingSessions.has(user.session)}
          own={user.session === ownSession}
        />
      ))}
    </span>
  );
}
