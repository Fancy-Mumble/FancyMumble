/**
 * Standard's picture of a user being carried between channels.
 *
 * The gesture, the drop targets and the seat that opens in the target channel
 * are `@ui/userCarry`'s, shared with Nebula. What lives here is the clone that
 * follows the pointer: a translucent slab with the face and the name on it,
 * which is this skin's answer and not the other one's.
 */

import { createPortal } from "react-dom";
import { useCarryUser } from "@ui/userCarry";

export { useChannelDropTarget } from "@ui/userCarry";

/** Result of `useUserDrag`. */
export interface UserDragResult {
  /** Spread on the draggable user row. */
  handlers: ReturnType<typeof useCarryUser>["handlers"];
  /** Portal-rendered floating clone (or `null` when idle). */
  overlay: React.ReactNode;
  /** True while the user is being dragged (after threshold). */
  isDragging: boolean;
}

/**
 * Make a user row draggable. When `disabled` is true the hook returns inert
 * handlers and never starts a drag (used for self / offline / mobile rows).
 */
export function useUserDrag(
  session: number,
  name: string,
  avatarUrl: string | null,
  disabled: boolean,
): UserDragResult {
  const carry = useCarryUser(session, disabled);

  // Through a portal, so the clone can travel outside the sidebar's overflow
  // clip box.
  const overlay =
    carry.ghost != null
      ? createPortal(
          <FloatingUserClone
            elRef={carry.ghostRef}
            width={carry.ghost.width}
            height={carry.ghost.height}
            initialLeft={carry.ghost.left}
            initialTop={carry.ghost.top}
            label={name}
            avatarUrl={avatarUrl}
          />,
          document.body,
        )
      : null;

  return { handlers: carry.handlers, overlay, isDragging: carry.isDragging };
}

// -- Floating clone (portal child) --------------------------------

interface FloatingUserCloneProps {
  elRef: React.MutableRefObject<HTMLElement | null>;
  width: number;
  height: number;
  initialLeft: number;
  initialTop: number;
  label: string;
  avatarUrl: string | null;
}

function FloatingUserClone({
  elRef,
  width,
  height,
  initialLeft,
  initialTop,
  label,
  avatarUrl,
}: FloatingUserCloneProps) {
  return (
    <div
      ref={elRef as React.MutableRefObject<HTMLDivElement | null>}
      style={{
        position: "fixed",
        left: 0,
        top: 0,
        width,
        height,
        transform: `translate(${initialLeft}px, ${initialTop}px)`,
        pointerEvents: "none",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "0 10px",
        borderRadius: 10,
        background: "rgba(30, 33, 40, 0.85)",
        border: "1px solid rgba(255, 255, 255, 0.18)",
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.45), 0 1px 0 rgba(255, 255, 255, 0.06) inset",
        backdropFilter: "blur(10px) saturate(160%)",
        WebkitBackdropFilter: "blur(10px) saturate(160%)",
        color: "#f5f6f8",
        font: "inherit",
        opacity: 0.95,
      }}
    >
      <div
        style={{
          width: 24,
          height: 24,
          borderRadius: "50%",
          background: avatarUrl ? "transparent" : "#5865f2",
          backgroundImage: avatarUrl ? `url(${avatarUrl})` : undefined,
          backgroundSize: "cover",
          backgroundPosition: "center",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 12,
          fontWeight: 600,
          flexShrink: 0,
        }}
      >
        {!avatarUrl && label.charAt(0).toUpperCase()}
      </div>
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
    </div>
  );
}
