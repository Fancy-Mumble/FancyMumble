import { useCallback, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./Tooltip.module.css";

interface TooltipProps {
  /** Tooltip text. When empty/undefined the children render with no tooltip. */
  readonly label?: string;
  /** Which side of the trigger the bubble appears on. */
  readonly placement?: "top" | "bottom";
  /** The trigger element(s) the tooltip is attached to. */
  readonly children: ReactNode;
}

/**
 * Lightweight, reusable hover/focus tooltip rendered into a body portal
 * (so it escapes `overflow: hidden` / stacking contexts). Wraps its
 * children in an inline-flex span that stretches to the trigger's box, so
 * it can host icon buttons in a flex row without changing their size.
 *
 * Prefer this over the native `title` attribute for in-app controls: it
 * is styled, theme-aware, wraps long text, and appears instantly.
 */
export function Tooltip({ label, placement = "top", children }: TooltipProps) {
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);

  const show = useCallback(() => {
    const el = ref.current;
    if (!el || !label) return;
    const rect = el.getBoundingClientRect();
    setCoords({
      x: rect.left + rect.width / 2,
      y: placement === "top" ? rect.top - 6 : rect.bottom + 6,
    });
  }, [label, placement]);

  const hide = useCallback(() => setCoords(null), []);

  return (
    <span
      ref={ref}
      className={styles.trigger}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {label &&
        coords &&
        createPortal(
          <div
            role="tooltip"
            className={`${styles.tooltip} ${placement === "bottom" ? styles.bottom : ""}`}
            style={{ left: coords.x, top: coords.y }}
          >
            {label}
          </div>,
          document.body,
        )}
    </span>
  );
}
