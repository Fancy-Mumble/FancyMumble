import { useAppStore } from "@core/store";
import type { ChannelEntry } from "@core/types";
import { Button, ModalSurface } from "../index";
import styles from "../../AuroraClientExtensions.module.css";

export interface PurgeChannelDialogProps {
  channel: ChannelEntry;
  onClose: () => void;
}

/** Confirmation for deleting a channel's persistent chat history. */
export default function PurgeChannelDialog({ channel, onClose }: PurgeChannelDialogProps) {
  const purge = () =>
    void useAppStore.getState().deletePchatMessages(channel.id, { timeTo: Date.now() }).then(onClose);

  return (
    <ModalSurface title={`Purge #${channel.name}`} eyebrow="DESTRUCTIVE ACTION" onClose={onClose}>
      <div className={styles.purgeConfirm}>
        <p>This removes all persistent messages in the channel up to the current time. This cannot be undone.</p>
        <footer>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" onClick={purge}>Purge history</Button>
        </footer>
      </div>
    </ModalSurface>
  );
}
