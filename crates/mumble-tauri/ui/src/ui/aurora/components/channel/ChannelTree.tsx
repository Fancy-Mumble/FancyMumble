import { Fragment, useMemo, type CSSProperties, type MouseEvent } from "react";
import type { ChannelEntry } from "@core/types";
import { ChevronDownIcon, ChevronRightIcon } from "@ui/icons";
import { ChannelRow } from "../chat";
import { IconButton } from "../primitives";
import styles from "../../AuroraClientExtensions.module.css";

export interface ChannelTreeProps {
  channels: ChannelEntry[];
  collapsed: ReadonlySet<number>;
  currentChannel: number | null;
  selectedChannel: number | null;
  unreadCounts: Record<number, number>;
  onSelect: (channel: ChannelEntry) => void;
  onToggle: (channelId: number) => void;
  onContextMenu?: (channel: ChannelEntry, event: MouseEvent<HTMLDivElement>) => void;
}

type TreeRow = { channel: ChannelEntry; depth: number; hasChildren: boolean };

export default function ChannelTree({ channels, collapsed, currentChannel, selectedChannel, unreadCounts, onSelect, onToggle, onContextMenu }: ChannelTreeProps) {
  const rows = useMemo(() => {
    const byParent = new Map<number | null, ChannelEntry[]>();
    const ids = new Set(channels.map((channel) => channel.id));
    for (const channel of channels) {
      const parent = channel.parent_id !== null && ids.has(channel.parent_id) ? channel.parent_id : null;
      byParent.set(parent, [...(byParent.get(parent) ?? []), channel]);
    }
    for (const siblings of byParent.values()) siblings.sort((left, right) => left.position - right.position || left.name.localeCompare(right.name));
    const result: TreeRow[] = [];
    const visit = (parent: number | null, depth: number) => {
      for (const channel of byParent.get(parent) ?? []) {
        const hasChildren = (byParent.get(channel.id)?.length ?? 0) > 0;
        result.push({ channel, depth, hasChildren });
        if (!collapsed.has(channel.id)) visit(channel.id, depth + 1);
      }
    };
    visit(null, 0);
    return result;
  }, [channels, collapsed]);

  return <>{rows.map(({ channel, depth, hasChildren }) => <Fragment key={channel.id}><div className={styles.channelTreeRow} style={{ "--channel-depth": depth } as CSSProperties} onContextMenu={(event) => { event.preventDefault(); onContextMenu?.(channel, event); }}>
    {hasChildren ? <IconButton icon={collapsed.has(channel.id) ? <ChevronRightIcon /> : <ChevronDownIcon />} label={collapsed.has(channel.id) ? `Expand ${channel.name}` : `Collapse ${channel.name}`} onClick={() => onToggle(channel.id)} /> : <span className={styles.channelTreeSpacer} />}
    <ChannelRow channel={channel} selected={channel.id === selectedChannel} current={channel.id === currentChannel} unread={unreadCounts[channel.id] ?? 0} onSelect={() => onSelect(channel)} />
  </div></Fragment>)}</>;
}
