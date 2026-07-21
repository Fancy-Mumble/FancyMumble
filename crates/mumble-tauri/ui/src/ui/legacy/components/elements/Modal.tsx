import { useCallback, useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./Modal.module.css";

interface ModalProps {
  /** Invoked when the modal requests dismissal (Esc or backdrop click). */
  readonly onClose: () => void;
  /** The dialog box.  Provide your own styled container (a `div` or `form`);
   *  the modal only supplies the centered, dimmed backdrop + behaviours. */
  readonly children: ReactNode;
  /** Dismiss when the backdrop (not the content) is clicked.  Default true. */
  readonly closeOnOverlayClick?: boolean;
  /** Dismiss on Escape.  Default true. */
  readonly closeOnEsc?: boolean;
  /** Extra class on the backdrop, e.g. to add a blur.  Use for additive
   *  styles that don't conflict with the base overlay. */
  readonly overlayClassName?: string;
  /** Explicit z-index for the backdrop (inline, so it reliably wins over the
   *  default).  Use when a modal must stack above another modal. */
  readonly zIndex?: number;
}

/**
 * Shared modal scaffold: a portalled, dimmed, centered backdrop that closes on
 * Escape and backdrop click.  Consolidates the portal + overlay + Esc +
 * click-outside boilerplate that was hand-rolled in every dialog.  The caller
 * owns the dialog box (its content + styling); the modal only manages the
 * backdrop and dismissal.
 */
export function Modal({
  onClose,
  children,
  closeOnOverlayClick = true,
  closeOnEsc = true,
  overlayClassName,
  zIndex,
}: ModalProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (closeOnEsc && e.key === "Escape") onClose();
    },
    [closeOnEsc, onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // `mousedown` (not `click`) so a text selection that ends outside the box
  // does not dismiss the dialog.  Only a press that starts on the backdrop
  // itself counts.
  const handleOverlayMouseDown = (e: React.MouseEvent) => {
    if (closeOnOverlayClick && e.target === e.currentTarget) onClose();
  };

  return createPortal(
    <div
      className={overlayClassName ? `${styles.overlay} ${overlayClassName}` : styles.overlay}
      style={zIndex != null ? { zIndex } : undefined}
      onMouseDown={handleOverlayMouseDown}
    >
      {children}
    </div>,
    document.body,
  );
}
