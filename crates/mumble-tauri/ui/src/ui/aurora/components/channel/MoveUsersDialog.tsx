import { useAppStore } from "@core/store";
import type { ChannelEntry } from "@core/types";
import { Button, ModalSurface } from "../index";
import styles from "../../AuroraClientExtensions.module.css";

export interface MoveUsersDialogProps {
  source: ChannelEntry;
  channels: readonly ChannelEntry[];
  onClose: () => void;
}

/** Pick a destination channel to move everyone in `source` into. */
export default function MoveUsersDialog({ source, channels, onClose }: MoveUsersDialogProps) {
  const targets = channels.filter((channel) => !channel.detached && channel.id !== source.id);
  return (
    <ModalSurface title={`Move everyone from #${source.name}`} eyebrow="CHANNEL MODERATION" onClose={onClose}>
      <div className={styles.channelTargetList}>
        {targets.map((channel) => (
          <Button
            variant="bare"
            key={channel.id}
            onClick={() => void useAppStore.getState().moveChannelUsers(source.id, channel.id).then(onClose)}
          >
            <span>#{channel.name}</span>
            <small>{channel.user_count} members</small>
          </Button>
        ))}
      </div>
    </ModalSurface>
  );
}
