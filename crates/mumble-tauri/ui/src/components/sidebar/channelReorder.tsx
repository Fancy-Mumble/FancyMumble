/**
 * Shared channel drag-to-reorder primitives, used by every channel
 * viewer (flat/modern/classic).  Wraps a single channel row and exposes
 * a hook that converts a [ChannelDropEvent] into the necessary
 * `update_channel` calls.
 */

import { useCallback, useRef } from "react";
import { GripVerticalIcon } from "../../icons";
import type { ChannelEntry } from "../../types";
import { useAppStore } from "../../store";
import {
  useChannelDrag,
  useChannelReorderTarget,
  type ChannelDropEvent,
} from "../../utils/channelReorderDnd";
import { canEditChannel } from "./ChannelEditorDialog";
import styles from "./channelReorder.module.css";

export interface ChannelReorderWrapperProps {
  readonly channel: ChannelEntry;
  readonly onReorder: (event: ChannelDropEvent) => void;
  /** Optional override; defaults to `canEditChannel(channel)`. */
  readonly canReorder?: boolean;
  /**
   * Render a small grip-handle affordance to the left of the row.
   * Set to false for hierarchical viewers where indentation must
   * remain pixel-aligned with the channel row.  Defaults to true.
   */
  readonly showHandle?: boolean;
  readonly innerRef?: React.RefCallback<HTMLDivElement>;
  readonly children: React.ReactNode;
}

/**
 * Wrap a channel row to make it draggable for reorder and droppable
 * as a reorder target.  Renders an optional grip-handle affordance on
 * the left and a placeholder outline while dragging.  The drag
 * handlers are spread on the wrapper itself, so users can grab
 * anywhere; the underlying hook ignores pointer-down on inputs and
 * elements marked `data-no-drag="true"`.
 */
export function ChannelReorderWrapper({
  channel,
  onReorder,
  canReorder,
  showHandle = true,
  innerRef,
  children,
}: ChannelReorderWrapperProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const normalizedParentId =
    channel.parent_id === channel.id ? null : channel.parent_id;
  const enabled =
    canReorder ?? (channel.permissions === null || canEditChannel(channel));

  const { ref: dropRef, dropPos } = useChannelReorderTarget(
    channel.id,
    normalizedParentId,
  );
  const { handleProps, cardStyle, overlay, isDragging } = useChannelDrag(
    channel.id,
    normalizedParentId,
    channel.name,
    !enabled,
    onReorder,
    wrapperRef,
  );

  const setRef = useCallback(
    (el: HTMLDivElement | null) => {
      wrapperRef.current = el;
      (dropRef as (el: HTMLElement | null) => void)(el);
      innerRef?.(el);
    },
    [dropRef, innerRef],
  );

  return (
    <div
      ref={setRef}
      className={`${styles.reorderWrapper} ${
        showHandle ? "" : styles.noHandle
      } ${dropPos === "before" ? styles.dropBefore : ""} ${
        dropPos === "after" ? styles.dropAfter : ""
      }`}
      style={isDragging ? { opacity: 0.4 } : undefined}
      {...(enabled ? handleProps : {})}
    >
      {overlay}
      {enabled && showHandle && (
        <div className={styles.dragHandle} aria-hidden="true">
          <GripVerticalIcon width={14} height={14} />
        </div>
      )}
      <div className={styles.cardSlot} style={cardStyle}>
        {children}
      </div>
      {isDragging && <div className={styles.dragPlaceholder} />}
    </div>
  );
}

/**
 * Build a stable callback that converts a [ChannelDropEvent] into a
 * series of `updateChannel` calls that re-number sibling positions
 * around the new index.  Positions are re-spaced at intervals of 100
 * to leave room for future inserts without renumbering every sibling.
 */
export function useChannelReorderHandler(channels: ChannelEntry[]) {
  const updateChannel = useAppStore((s) => s.updateChannel);
  return useCallback(
    ({ draggedId, targetId, insertBefore }: ChannelDropEvent) => {
      const dragged = channels.find((c) => c.id === draggedId);
      if (!dragged) return;
      const siblings = channels
        .filter(
          (c) =>
            c.parent_id === dragged.parent_id ||
            (c.parent_id === c.id && dragged.parent_id === dragged.id),
        )
        .sort((a, b) =>
          a.position !== b.position
            ? a.position - b.position
            : a.name.localeCompare(b.name),
        );
      const withoutDragged = siblings.filter((c) => c.id !== draggedId);
      const targetIdx = withoutDragged.findIndex((c) => c.id === targetId);
      if (targetIdx === -1) return;
      const insertIdx = insertBefore ? targetIdx : targetIdx + 1;
      withoutDragged.splice(insertIdx, 0, dragged);
      withoutDragged.forEach((c, i) => {
        const newPos = i * 100;
        if (c.position !== newPos) {
          updateChannel(c.id, { position: newPos }).catch((err: unknown) =>
            console.error("Channel reorder failed:", err),
          );
        }
      });
    },
    [channels, updateChannel],
  );
}
