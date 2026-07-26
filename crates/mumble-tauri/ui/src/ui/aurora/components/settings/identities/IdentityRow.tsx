import { useState } from "react";
import { Button } from "../../primitives";
import styles from "./Identities.module.css";

export interface IdentityRowProps {
  label: string;
  connected: boolean;
  onExport: (label: string) => void;
  onDelete: (label: string) => void;
  onEditProfile: (label: string) => void;
}

/**
 * One stored identity.
 *
 * Delete is a two-step confirm held in this row rather than the panel: losing a
 * certificate means losing the registered account it authenticates, and the
 * confirmation should die with the row if the list refreshes underneath it.
 */
export default function IdentityRow({
  label,
  connected,
  onExport,
  onDelete,
  onEditProfile,
}: IdentityRowProps) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className={styles.row}>
      <span className={styles.label}>
        {label}
        {connected && <span className={styles.connected}>IN USE</span>}
      </span>
      <span className={styles.actions}>
        <Button variant="bare" onClick={() => onEditProfile(label)}>
          Edit profile
        </Button>
        <Button variant="bare" onClick={() => onExport(label)}>
          Export
        </Button>
        {confirming ? (
          <>
            <Button variant="danger" onClick={() => onDelete(label)}>
              Delete permanently
            </Button>
            <Button variant="bare" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button variant="danger" onClick={() => setConfirming(true)}>
            Delete
          </Button>
        )}
      </span>
    </div>
  );
}
