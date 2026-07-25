import type { MouseEvent } from "react";
import type { ChannelEntry, UserEntry } from "@core/types";
import { HashIcon, HeadphonesIcon, LockIcon } from "@ui/icons";
import { PERM_ENTER } from "@core/utils/permissions";
import { Button } from "../primitives";
import ChannelPresence from "./ChannelPresence";
import styles from "./ChannelList.module.css";

export interface ChannelListItemProps {
  channel: ChannelEntry;
  users: UserEntry[];
  selected: boolean;
  current: boolean;
  listened: boolean;
  unread: number;
  talkingSessions: ReadonlySet<number>;
  ownSession?: number | null;
  onSelect: () => void;
  onJoin: () => void;
  onContextMenu?: (event: MouseEvent<HTMLElement>) => void;
}

export default function ChannelListItem({
  channel,
  users,
  selected,
  current,
  listened,
  unread,
  talkingSessions,
  ownSession,
  onSelect,
  onJoin,
  onContextMenu,
}: ChannelListItemProps) {
  const locked = !current && channel.permissions !== null && (channel.permissions & PERM_ENTER) === 0;
  const className = [
    styles.item,
    selected ? styles.selected : "",
    current ? styles.current : "",
    locked ? styles.locked : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <>
    <Button
      variant="bare"
      wrapLabel={false}
      className={className}
      aria-current={current ? "true" : undefined}
      onClick={onSelect}
      onDoubleClick={onJoin}
      onContextMenu={onContextMenu}
    >
      <HashIcon />
      <span className={styles.name}>{channel.name}</span>
      {locked && <LockIcon className={styles.badgeIcon} />}
      {listened && <HeadphonesIcon className={styles.badgeIcon} />}
      {unread > 0 && <b className={styles.unread}>{unread > 99 ? "99+" : unread}</b>}
      {users.length > 0 && <span className={styles.count}>{users.length}</span>}
    </Button>
    <ChannelPresence users={users} talkingSessions={talkingSessions} ownSession={ownSession} />
    </>
  );
}
