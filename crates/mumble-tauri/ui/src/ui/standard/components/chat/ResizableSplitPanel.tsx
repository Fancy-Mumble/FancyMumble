/**
 * ResizableSplitPanel - a content panel stacked above the chat column with a
 * draggable handle that lets the user resize the split.  This is the
 * reusable extraction of the split UX the Live Doc panel pioneered, so the
 * same drag-to-resize behaviour can be shared by every panel that takes over
 * the top of the chat area (downloads, pinned messages, screen-share, ...).
 *
 * Usage: render it inside ChatView's `<main>` flex column with the chat column
 * as the following sibling.  The handle resizes this panel's height; the chat
 * fills whatever remains.  The wrapped content should fill the panel
 * (`flex: 1; min-height: 0;` with its own internal scroll) rather than impose a
 * fixed height of its own.
 */

import { useCallback, useRef, useState, type ReactNode } from "react";
import PanelCloseButton from "./PanelCloseButton";
import styles from "./ResizableSplitPanel.module.css";

interface ResizableSplitPanelProps {
  readonly children: ReactNode;
  /** Optional extra class applied to the panel container. */
  readonly className?: string;
  /** When set, renders a consistent close (×) button in the panel's top-right
   *  corner.  Panels that already have their own header close should omit this. */
  readonly onClose?: () => void;
  /** Accessible label for the close button. */
  readonly closeLabel?: string;
  /** Initial panel height in px (used when `fillByDefault` is false). */
  readonly defaultPx?: number;
  /** When true, the panel fills the available space until the user first drags
   *  the handle (the Live Doc / screen-share behaviour); otherwise it starts at
   *  `defaultPx`. */
  readonly fillByDefault?: boolean;
  /** Minimum panel height in px. */
  readonly minPx?: number;
  /** Minimum height to leave for the sibling (chat) below the handle. */
  readonly minRemainingPx?: number;
  /** Accessible label for the drag handle. */
  readonly handleLabel?: string;
}

/** Clamp a candidate height into `[min, max]` (max is floored at `min`). */
export function clampSplitHeight(px: number, min: number, max: number): number {
  return Math.max(min, Math.min(Math.max(min, max), px));
}

export default function ResizableSplitPanel({
  children,
  className,
  onClose,
  closeLabel,
  defaultPx = 300,
  fillByDefault = false,
  minPx = 150,
  minRemainingPx = 120,
  handleLabel,
}: ResizableSplitPanelProps) {
  // `null` = fill the remaining space; a number = a fixed, user-chosen height.
  const [heightPx, setHeightPx] = useState<number | null>(fillByDefault ? null : defaultPx);
  const panelRef = useRef<HTMLDivElement>(null);

  const onHandleDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const panel = panelRef.current;
      const startPx = panel?.getBoundingClientRect().height ?? defaultPx;
      const parent = panel?.parentElement ?? null;
      const onMove = (mv: MouseEvent) => {
        const delta = mv.clientY - startY;
        const parentH = parent?.getBoundingClientRect().height ?? window.innerHeight;
        setHeightPx(clampSplitHeight(startPx + delta, minPx, parentH - minRemainingPx));
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [defaultPx, minPx, minRemainingPx],
  );

  return (
    <>
      <div
        ref={panelRef}
        className={[styles.panel, heightPx === null ? styles.fill : "", className]
          .filter(Boolean)
          .join(" ")}
        style={heightPx !== null ? { flex: `0 0 ${heightPx}px` } : undefined}
      >
        {onClose && <PanelCloseButton onClose={onClose} label={closeLabel} />}
        {children}
      </div>
      <div
        className={styles.handle}
        onMouseDown={onHandleDown}
        role="separator"
        aria-orientation="horizontal"
        aria-label={handleLabel}
      />
    </>
  );
}
