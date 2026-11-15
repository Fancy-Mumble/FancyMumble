import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import styles from "./ContextMenu.module.css";

export interface ContextMenuProps {
  /** Viewport coordinates of the originating right-click. */
  x: number;
  y: number;
  /** Small title above the items, e.g. the channel the menu acts on. */
  heading?: ReactNode;
  /** Accessible name, since the heading is decorative. */
  label: string;
  children: ReactNode;
}

const EDGE_MARGIN = 8;

/**
 * Floating menu anchored to a right-click.
 *
 * The requested point is clamped to the viewport once the menu has been
 * measured, so a click near the bottom or right edge does not open a menu that
 * runs off-screen with its last items unreachable.
 */
export default function ContextMenu({ x, y, heading, label, children }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    setPosition({
      left: Math.max(EDGE_MARGIN, Math.min(x, globalThis.innerWidth - width - EDGE_MARGIN)),
      top: Math.max(EDGE_MARGIN, Math.min(y, globalThis.innerHeight - height - EDGE_MARGIN)),
    });
  }, [x, y]);

  return (
    <div
      ref={ref}
      className={styles.menu}
      style={{ left: position.left, top: position.top }}
      role="menu"
      aria-label={label}
      onClick={(event) => event.stopPropagation()}
    >
      {heading && <div className={styles.heading}>{heading}</div>}
      {children}
    </div>
  );
}
