import type { MouseEvent } from "react";
import type { ChannelEntry } from "@core/types";
import styles from "./ChannelList.module.css";

export interface ChannelCategoryRowProps {
  channel: ChannelEntry;
  onContextMenu?: (event: MouseEvent<HTMLElement>) => void;
}

/**
 * A structural channel: it cannot be entered and holds no users, so it renders
 * as a heading for the channels beneath it rather than a selectable row.
 */
export default function ChannelCategoryRow({ channel, onContextMenu }: ChannelCategoryRowProps) {
  return (
    <h3 className={styles.category} onContextMenu={onContextMenu}>
      {channel.name}
    </h3>
  );
}
