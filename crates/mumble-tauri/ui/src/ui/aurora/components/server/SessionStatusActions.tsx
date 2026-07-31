import { Button } from "../primitives";
import styles from "./SessionStatusScreen.module.css";

export interface SessionStatusActionsProps {
  retryLabel: string;
  onRetry: () => void;
  onOpenServers: () => void;
  onClose: () => void;
}

export default function SessionStatusActions({
  retryLabel,
  onRetry,
  onOpenServers,
  onClose,
}: SessionStatusActionsProps) {
  return (
    <div className={styles.actions}>
      <div className={styles.actionRow}>
        <Button variant="primary" onClick={onRetry}>
          {retryLabel}
        </Button>
        <Button variant="danger" onClick={onClose}>
          Close session
        </Button>
      </div>
      <Button variant="bare" className={styles.tertiary} onClick={onOpenServers}>
        Choose a server
      </Button>
    </div>
  );
}
