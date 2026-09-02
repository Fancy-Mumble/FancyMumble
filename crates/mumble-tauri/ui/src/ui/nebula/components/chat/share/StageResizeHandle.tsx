import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Box } from "@mui/material";
import { TID } from "@core/testids";
import { STAGE_HEIGHT_DEFAULT, STAGE_HEIGHT_MIN, STAGE_HEIGHT_STEP } from "./stageHeight";

export interface StageResizeHandleProps {
  readonly height: number;
  /** The most the stage may take right now, measured by the owner. */
  readonly maxHeight: () => number;
  /** Fired on every pointer move and every keystroke. The owner clamps and
   *  answers with what it applied, so the next step starts from the truth
   *  rather than from a request that was refused. */
  readonly onChange: (height: number) => number;
  /** The gesture is over: the owner persists what it has. */
  readonly onCommit: () => void;
}

/**
 * The grab bar under the share stage - the pill Android draws on a sheet that
 * can be pulled taller.
 *
 * The stage and the conversation share one column, and no single split suits
 * both a lecture and a game night. The bar is the affordance that says the
 * split is theirs to set: drag it down for more picture, up for more chat, and
 * double-click it to go back to the default. It is a separator to assistive
 * tech, so the arrow keys move it too.
 */
export function StageResizeHandle({
  height,
  maxHeight,
  onChange,
  onCommit,
}: Readonly<StageResizeHandleProps>) {
  const [dragging, setDragging] = useState(false);
  const origin = useRef<{ y: number; height: number } | null>(null);
  // The height as of the last change, whether or not React has rendered it
  // yet: key repeats and a release right after a move both arrive before the
  // prop catches up.
  const current = useRef(height);
  useEffect(() => {
    current.current = height;
  }, [height]);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    origin.current = { y: event.clientY, height: current.current };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // A pointer that is already gone (or a synthetic one) cannot be
      // captured; the drag still follows it while it stays over the bar.
    }
    setDragging(true);
  }, []);

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const start = origin.current;
      if (!start) return;
      current.current = onChange(start.height + event.clientY - start.y);
    },
    [onChange],
  );

  const endDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!origin.current) return;
      origin.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setDragging(false);
      onCommit();
    },
    [onCommit],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const next = KEY_TARGET[event.key]?.(current.current, maxHeight());
      if (next === undefined) return;
      event.preventDefault();
      current.current = onChange(next);
      onCommit();
    },
    [maxHeight, onChange, onCommit],
  );

  const reset = useCallback(() => {
    current.current = onChange(STAGE_HEIGHT_DEFAULT);
    onCommit();
  }, [onChange, onCommit]);

  const { t } = useTranslation("nebulaChat");

  return (
    <Box
      role="separator"
      aria-orientation="horizontal"
      aria-label={t("share.resizeStage")}
      aria-valuemin={STAGE_HEIGHT_MIN}
      aria-valuenow={height}
      tabIndex={0}
      title={t("share.resizeHint")}
      data-testid={TID.streamStageResizeHandle}
      data-dragging={dragging ? "true" : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      onDoubleClick={reset}
      sx={(theme) => ({
        // Sits in the panel's bottom padding so the picture keeps its inset
        // while the whole lower edge is a target, not just the pill.
        height: 16,
        margin: "0 -6px -6px",
        flex: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "ns-resize",
        touchAction: "none",
        userSelect: "none",
        outline: "none",
        borderRadius: "inherit",
        "&::after": {
          content: '""',
          width: 36,
          height: 4,
          borderRadius: 999,
          background: dragging ? theme.palette.nebula.accent : theme.palette.nebula.dim,
          transition: "background .15s, width .15s",
        },
        "&:hover::after, &:focus-visible::after": {
          width: 44,
          background: dragging ? theme.palette.nebula.accent : theme.palette.nebula.muted,
        },
      })}
    />
  );
}

/** Where each key sends the stage, given where it is and how far it may go. */
const KEY_TARGET: Record<string, ((height: number, max: number) => number) | undefined> = {
  ArrowDown: (height) => height + STAGE_HEIGHT_STEP,
  ArrowUp: (height) => height - STAGE_HEIGHT_STEP,
  PageDown: (height) => height + STAGE_HEIGHT_STEP * 4,
  PageUp: (height) => height - STAGE_HEIGHT_STEP * 4,
  Home: () => STAGE_HEIGHT_MIN,
  End: (_height, max) => max,
};
