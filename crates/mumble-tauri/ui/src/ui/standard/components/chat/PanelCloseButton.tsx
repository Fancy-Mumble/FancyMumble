/**
 * PanelCloseButton - the single, canonical close (×) used by every panel that
 * splits the chat (downloads, pinned messages, screen-share, document library).
 * Having one component guarantees they all look identical and sit in the same
 * spot (top-right corner).  The containing panel must be `position: relative`.
 */

import { CloseIcon } from "../../icons";
import styles from "./PanelCloseButton.module.css";

interface PanelCloseButtonProps {
  readonly onClose: () => void;
  /** Accessible label / tooltip. */
  readonly label?: string;
}

export default function PanelCloseButton({ onClose, label }: PanelCloseButtonProps) {
  return (
    <button
      type="button"
      className={styles.closeBtn}
      onClick={onClose}
      title={label}
      aria-label={label}
    >
      <CloseIcon width={16} height={16} />
    </button>
  );
}
