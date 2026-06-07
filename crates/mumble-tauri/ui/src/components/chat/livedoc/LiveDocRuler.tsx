/**
 * LiveDocRuler - Word-style horizontal and vertical rulers that frame the
 * editor page.
 *
 * Each ruler is a full-bleed strip pinned to the document-view edge
 * (horizontal at the very top, vertical at the very left) wrapping an inner
 * element that is centred to match the page.  The inner element renders
 * evenly spaced tick marks (drawn via repeating gradients in CSS), a shaded
 * band over the page margins, numeric labels, and small triangular
 * margin-boundary handles.  Everything is keyed to the shared
 * `--ld-pad-x` / `--ld-pad-y` / `--ld-major` custom properties set on
 * `.editorScroll`, so the markers always line up with the page padding.
 *
 * The triangular handles are draggable: pulling one in/out resizes the
 * page margin (symmetric per axis, like the shaded margin band).  The drag
 * reports a live preview while moving and commits the final value on
 * release; see `LiveDocEditor` for the wiring into the shared page setup.
 */

import { useState, useEffect } from "react";
import styles from "./LiveDocRuler.module.css";
import type { LiveDocRulerUnit } from "./useLiveDoc";

/** Number of major-tick labels to render on each axis.  Extra labels past
 *  the page edge are clipped by the ruler's `overflow: hidden`. */
const H_LABEL_COUNT = 8;
const V_LABEL_COUNT = 14;

const PX_PER_CM = 96 / 2.54;
const PX_PER_IN = 96;

function pxToUnit(px: number, unit: LiveDocRulerUnit): string {
  if (unit === "cm") return `${(px / PX_PER_CM).toFixed(2)} cm`;
  return `${(px / PX_PER_IN).toFixed(2)} in`;
}

function useAltKey(): boolean {
  const [altDown, setAltDown] = useState(false);
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => { if (e.key === "Alt") setAltDown(true); };
    const onUp = (e: KeyboardEvent) => { if (e.key === "Alt") setAltDown(false); };
    const onBlur = () => setAltDown(false);
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);
  return altDown;
}

function range(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i + 1);
}

/** Which edge a handle controls: the page-start margin (left / top) or the
 *  page-end margin (right / bottom). */
type HandleSide = "start" | "end";

interface RulerProps {
  /** Current (possibly mid-drag preview) margin for this axis in CSS px. */
  readonly marginPx: number;
  /** Total page dimension for this axis in CSS px (used for Alt overlay). */
  readonly pageSizePx: number;
  /** Unit to display in the Alt-key measurement overlay. */
  readonly rulerUnit: LiveDocRulerUnit;
  /** Clamp range for the margin in CSS px. */
  readonly min: number;
  readonly max: number;
  /** When false the handles are inert (read-only documents). */
  readonly interactive: boolean;
  /** Live margin while dragging (not yet persisted). */
  readonly onPreview: (px: number) => void;
  /** Final margin on pointer release / keyboard change (persisted). */
  readonly onCommit: (px: number) => void;
  /** Called with true when a drag starts, false when it ends or is cancelled. */
  readonly onDragChange?: (dragging: boolean) => void;
}

/**
 * Build a pointer-down handler that drags a margin handle.  The handle's
 * positioned parent (`.rulerH` / `.rulerV`) is the page coordinate frame:
 * offsets are measured from its leading edge, so the value maps 1:1 to the
 * page padding regardless of how the ruler is sized/centred.
 */
function makePointerDown(
  axis: "x" | "y",
  side: HandleSide,
  { min, max, onPreview, onCommit, onDragChange }: RulerProps,
) {
  return (e: React.PointerEvent<HTMLSpanElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    const frame = handle.parentElement;
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    const compute = (clientX: number, clientY: number): number => {
      const size = axis === "x" ? rect.width : rect.height;
      const origin = axis === "x" ? rect.left : rect.top;
      const offset = (axis === "x" ? clientX : clientY) - origin;
      const raw = side === "start" ? offset : size - offset;
      return Math.round(Math.min(max, Math.max(min, raw)));
    };
    handle.setPointerCapture(e.pointerId);
    onDragChange?.(true);
    const onMove = (ev: PointerEvent) => onPreview(compute(ev.clientX, ev.clientY));
    const onUp = (ev: PointerEvent) => {
      onCommit(compute(ev.clientX, ev.clientY));
      onDragChange?.(false);
      handle.releasePointerCapture(ev.pointerId);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onCancel);
    };
    const onCancel = () => {
      onDragChange?.(false);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onCancel);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onCancel);
  };
}

/** Arrow-key handler so the margin handles are usable without a pointer. */
function makeKeyDown(props: RulerProps) {
  const { marginPx, min, max, onCommit } = props;
  return (e: React.KeyboardEvent<HTMLSpanElement>) => {
    const step = e.shiftKey ? 10 : 1;
    let next: number | null = null;
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = marginPx - step;
    else if (e.key === "ArrowRight" || e.key === "ArrowDown") next = marginPx + step;
    else if (e.key === "Home") next = min;
    else if (e.key === "End") next = max;
    if (next === null) return;
    e.preventDefault();
    onCommit(Math.round(Math.min(max, Math.max(min, next))));
  };
}

function handleProps(
  axis: "x" | "y",
  side: HandleSide,
  label: string,
  props: RulerProps,
) {
  const { marginPx, min, max, interactive } = props;
  if (!interactive) return {};
  return {
    role: "slider" as const,
    tabIndex: 0,
    "aria-label": label,
    "aria-valuemin": min,
    "aria-valuemax": max,
    "aria-valuenow": marginPx,
    title: label,
    onPointerDown: makePointerDown(axis, side, props),
    onKeyDown: makeKeyDown(props),
  };
}

export function LiveDocRulerHorizontal(props: RulerProps) {
  const { marginPx, pageSizePx, rulerUnit } = props;
  const altDown = useAltKey();
  const cls = props.interactive ? styles.handleH : `${styles.handleH} ${styles.handleStatic}`;
  const contentPx = Math.max(0, pageSizePx - 2 * marginPx);
  const leftPct = (marginPx / pageSizePx) * 100;
  const contentPct = (contentPx / pageSizePx) * 100;
  return (
    <div className={styles.rulerHWrap}>
      <div className={styles.rulerH}>
        <div className={styles.marginBandH} aria-hidden="true" />
        {range(H_LABEL_COUNT).map((n) => (
          <span
            key={n}
            className={styles.labelH}
            aria-hidden="true"
            style={{ left: `calc(var(--ld-pad-x) + ${n} * var(--ld-major))` }}
          >
            {n}
          </span>
        ))}
        <span
          className={cls}
          style={{ left: "var(--ld-pad-x)" }}
          {...handleProps("x", "start", "Left margin", props)}
        />
        <span
          className={cls}
          style={{ left: "calc(100% - var(--ld-pad-x))" }}
          {...handleProps("x", "end", "Right margin", props)}
        />
        {altDown && (
          <div className={styles.measureOverlay} aria-hidden="true">
            <span
              className={styles.measureLabel}
              style={{ left: `${leftPct / 2}%`, maxWidth: `${leftPct}%` }}
            >
              {pxToUnit(marginPx, rulerUnit)}
            </span>
            <span
              className={styles.measureLabel}
              style={{ left: `${leftPct + contentPct / 2}%`, maxWidth: `${contentPct}%` }}
            >
              {pxToUnit(contentPx, rulerUnit)}
            </span>
            <span
              className={styles.measureLabel}
              style={{ left: `${leftPct + contentPct + leftPct / 2}%`, maxWidth: `${leftPct}%` }}
            >
              {pxToUnit(marginPx, rulerUnit)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export function LiveDocRulerVertical(props: RulerProps) {
  const { marginPx, pageSizePx, rulerUnit } = props;
  const altDown = useAltKey();
  const cls = props.interactive ? styles.handleV : `${styles.handleV} ${styles.handleStatic}`;
  const contentPx = Math.max(0, pageSizePx - 2 * marginPx);
  const topPct = (marginPx / pageSizePx) * 100;
  const contentPct = (contentPx / pageSizePx) * 100;
  return (
    <div className={styles.rulerVWrap}>
      <div className={styles.rulerV}>
        <div className={styles.marginBandV} aria-hidden="true" />
        {range(V_LABEL_COUNT).map((n) => (
          <span
            key={n}
            className={styles.labelV}
            aria-hidden="true"
            style={{ top: `calc(var(--ld-pad-y) + ${n} * var(--ld-major))` }}
          >
            {n}
          </span>
        ))}
        <span
          className={cls}
          style={{ top: "var(--ld-pad-y)" }}
          {...handleProps("y", "start", "Top margin", props)}
        />
        <span
          className={cls}
          style={{ top: "calc(100% - var(--ld-pad-y))" }}
          {...handleProps("y", "end", "Bottom margin", props)}
        />
        {altDown && (
          <div className={styles.measureOverlayV} aria-hidden="true">
            <span
              className={styles.measureLabelV}
              style={{ top: `${topPct / 2}%`, maxHeight: `${topPct}%` }}
            >
              {pxToUnit(marginPx, rulerUnit)}
            </span>
            <span
              className={styles.measureLabelV}
              style={{ top: `${topPct + contentPct / 2}%`, maxHeight: `${contentPct}%` }}
            >
              {pxToUnit(contentPx, rulerUnit)}
            </span>
            <span
              className={styles.measureLabelV}
              style={{ top: `${topPct + contentPct + topPct / 2}%`, maxHeight: `${topPct}%` }}
            >
              {pxToUnit(marginPx, rulerUnit)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
