import { useMemo, type MouseEvent } from "react";
import type { ChannelEntry, UserEntry } from "@core/types";
import { isStructuralChannel } from "@core/utils/channelAttributes";
import ChannelCategoryRow from "./ChannelCategoryRow";
import ChannelListItem from "./ChannelListItem";
import { flattenChannels } from "./channelOrder";
import styles from "./ChannelList.module.css";

export interface ChannelListProps {
  channels: ChannelEntry[];
  users: UserEntry[];
  selectedChannel: number | null;
  currentChannel: number | null;
  listenedChannels: ReadonlySet<number>;
  unreadCounts: Record<number, number>;
  talkingSessions: ReadonlySet<number>;
  onSelect: (channel: ChannelEntry) => void;
  onJoin: (channel: ChannelEntry) => void;
  onContextMenu?: (channel: ChannelEntry, event: MouseEvent<HTMLElement>) => void;
}

/** Flat channel viewer: every channel on one level, in server order. */
export default function ChannelList({ channels, users, selectedChannel, currentChannel, listenedChannels, unreadCounts, talkingSessions, onSelect, onJoin, onContextMenu }: ChannelListProps) {
  const ordered = useMemo(() => flattenChannels(channels), [channels]);
  const usersByChannel = useMemo(() => {
    const map = new Map<number, UserEntry[]>();
    for (const user of users) map.set(user.channel_id, [...(map.get(user.channel_id) ?? []), user]);
    return map;
  }, [users]);

  return <div className={styles.list}>{ordered.map((channel) => isStructuralChannel(channel) ? <ChannelCategoryRow
    key={channel.id}
    channel={channel}
    onContextMenu={onContextMenu && ((event) => { event.preventDefault(); event.stopPropagation(); onContextMenu(channel, event); })}
  /> : <ChannelListItem
    key={channel.id}
    channel={channel}
    users={usersByChannel.get(channel.id) ?? []}
    selected={channel.id === selectedChannel}
    current={channel.id === currentChannel}
    listened={listenedChannels.has(channel.id)}
    unread={unreadCounts[channel.id] ?? 0}
    talkingSessions={talkingSessions}
    onSelect={() => onSelect(channel)}
    onJoin={() => onJoin(channel)}
    onContextMenu={onContextMenu && ((event) => { event.preventDefault(); event.stopPropagation(); onContextMenu(channel, event); })}
  />)}</div>;
}
