import type { ChannelEntry } from "@core/types";
import { HashIcon } from "@ui/icons";
import styles from "../../NewClientApp.module.css";
import { Button } from "../primitives";

export type ChannelRowProps = { channel: ChannelEntry; selected: boolean; current: boolean; unread: number; onSelect: () => void };

export default function ChannelRow({ channel, selected, current, unread, onSelect }: ChannelRowProps) {
  return <Button variant="bare" wrapLabel={false} className={selected ? styles.channelActive : styles.channel} onClick={onSelect}>
    <HashIcon /><span>{channel.name}</span>
    {current && <i className={styles.currentDot} title="Your current channel" />}
    {unread > 0 && <b>{unread > 99 ? "99+" : unread}</b>}
  </Button>;
}
