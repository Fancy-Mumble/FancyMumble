import type { UserEntry } from "@core/types";
import ChannelPresenceAvatar from "./ChannelPresenceAvatar";
import styles from "./ChannelList.module.css";

const MAX_STACKED = 3;

export interface ChannelPresenceProps {
  users: UserEntry[];
  talkingSessions: ReadonlySet<number>;
}

export default function ChannelPresence({ users, talkingSessions }: ChannelPresenceProps) {
  if (users.length === 0) return null;
  const overflow = users.length - MAX_STACKED;
  return (
    <span className={styles.presence}>
      {users.slice(0, MAX_STACKED).map((user) => (
        <ChannelPresenceAvatar
          key={user.session}
          name={user.name}
          talking={talkingSessions.has(user.session)}
        />
      ))}
      {overflow > 0 && <span className={styles.presenceOverflow}>+{overflow}</span>}
    </span>
  );
}
