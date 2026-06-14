/**
 * React node view for [`LiveDocImage`].  Renders the underlying
 * `<img>` plus, while the image is selected:
 *
 *   * 8 resize handles (4 corners + 4 edge midpoints) - Google Docs
 *     style.  Corner drags preserve aspect ratio (Shift to free-form).
 *   * 1 rotate handle above the image.
 *   * A floating wrap-mode toolbar below the image with the five
 *     `wrap` choices.
 *
 * Wrap modes:
 *
 *   * `inline`  - normal block image, fills its line
 *   * `wrap`    - float: left so subsequent text wraps around
 *   * `break`   - clear: both block (text breaks above and below)
 *   * `behind`  - position: absolute, z-index: -1 (text flows over)
 *   * `front`   - position: absolute, z-index: 2 (sits over the text)
 *
 * Pointer-event handling is careful so that:
 *   - Clicks on the image set node selection (Tiptap handles this).
 *   - Drags on a handle resize/rotate without selecting text.
 *   - The wrap-mode toolbar lives outside the resize chrome so it
 *     doesn't get hit-tested during drags.
 */

import { RefreshCwIcon } from "../../../icons";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";

import { IMAGE_WRAP_MODES, type ImageWrapMode } from "./LiveDocImage";
import {
  type DropDragState,
  computeDropIndicator,
  computeSideZone,
} from "./LiveDocImageDrag";
import { WrapIcon, wrapLabel } from "./LiveDocImageHelpers";
import styles from "./LiveDocImageView.module.css";

const MIN_DIMENSION = 24;
const ROTATE_HANDLE_OFFSET = 28;

type HandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

const HANDLES: ReadonlyArray<{ readonly id: HandleId; readonly cls: string }> = [
  { id: "nw", cls: "handleNW" },
  { id: "n", cls: "handleN" },
  { id: "ne", cls: "handleNE" },
  { id: "e", cls: "handleE" },
  { id: "se", cls: "handleSE" },
  { id: "s", cls: "handleS" },
  { id: "sw", cls: "handleSW" },
  { id: "w", cls: "handleW" },
];

export default function LiveDocImageView(props: NodeViewProps) {
  const { node, selected, updateAttributes, editor } = props;
  const { t } = useTranslation("chat");
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const src = node.attrs.src as string;
  const alt = (node.attrs.alt as string | null) ?? "";
  const width = node.attrs.width as number | null;
  const height = node.attrs.height as number | null;
  const rotation = (node.attrs.rotation as number | undefined) ?? 0;
  const wrap = (node.attrs.wrap as ImageWrapMode | undefined) ?? "inline";
  const x = node.attrs.x as number | null;
  const y = node.attrs.y as number | null;

  /** Ghost / drop-indicator state shown while dragging in a
   *  drop-anchor wrap mode (`wrap` / `break`).  Lives in this
   *  component (rather than refs) so the portal re-renders on
   *  every pointermove. */
  const [dropState, setDropState] = useState<DropDragState | null>(null);

  const editable = editor.isEditable;
  const showChrome = selected && editable;
  const freePosition = wrap === "behind" || wrap === "front";
  const draggable = editable;

  const containerStyle = useMemo<CSSProperties>(() => {
    const style: CSSProperties = {};
    if (width) style.width = `${width}px`;
    // x/y are only meaningful for absolutely-positioned modes.  For
    // wrap (float) and break (block), the position is determined by
    // text flow, so we leave left/top alone.
    if (freePosition && x != null) style.left = `${x}px`;
    if (freePosition && y != null) style.top = `${y}px`;
    return style;
  }, [width, freePosition, x, y]);

  const imgStyle = useMemo<CSSProperties>(() => {
    const style: CSSProperties = {};
    if (width) style.width = "100%";
    if (height) style.height = `${height}px`;
    if (rotation) style.transform = `rotate(${rotation}deg)`;
    return style;
  }, [width, height, rotation]);

  const wrapToolbarRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!showChrome || !containerRef.current || !wrapToolbarRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    wrapToolbarRef.current.style.left = `${rect.left + rect.width / 2}px`;
    wrapToolbarRef.current.style.top = `${rect.bottom + 8}px`;
  });

  // ---- Resize logic -------------------------------------------------------

  const startResize = useCallback(
    (handle: HandleId, e: ReactPointerEvent) => {
      if (!editable) return;
      e.preventDefault();
      e.stopPropagation();
      const img = imgRef.current;
      if (!img) return;
      const startX = e.clientX;
      const startY = e.clientY;
      const startW = img.offsetWidth;
      const startH = img.offsetHeight;
      const ratio = startH > 0 ? startW / startH : 1;
      const lockRatio = handle === "nw" || handle === "ne" || handle === "sw" || handle === "se";

      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        let nextW = startW;
        let nextH = startH;
        // East / West handles
        if (handle === "e" || handle === "ne" || handle === "se") nextW = startW + dx;
        if (handle === "w" || handle === "nw" || handle === "sw") nextW = startW - dx;
        // North / South handles
        if (handle === "s" || handle === "se" || handle === "sw") nextH = startH + dy;
        if (handle === "n" || handle === "ne" || handle === "nw") nextH = startH - dy;
        if (lockRatio && !ev.shiftKey) {
          // Resolve the larger of the two normalised deltas.
          const wRatio = nextW / startW;
          const hRatio = nextH / startH;
          if (Math.abs(wRatio - 1) > Math.abs(hRatio - 1)) {
            nextH = Math.max(MIN_DIMENSION, nextW / ratio);
          } else {
            nextW = Math.max(MIN_DIMENSION, nextH * ratio);
          }
        }
        nextW = Math.max(MIN_DIMENSION, Math.round(nextW));
        nextH = Math.max(MIN_DIMENSION, Math.round(nextH));
        updateAttributes({ width: nextW, height: nextH });
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [editable, updateAttributes],
  );

  // ---- Rotate logic -------------------------------------------------------

  const startRotate = useCallback(
    (e: ReactPointerEvent) => {
      if (!editable) return;
      e.preventDefault();
      e.stopPropagation();
      const img = imgRef.current;
      if (!img) return;
      const rect = img.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const startAngle = Math.atan2(e.clientY - cy, e.clientX - cx);
      const startRotation = rotation;

      const onMove = (ev: PointerEvent) => {
        const a = Math.atan2(ev.clientY - cy, ev.clientX - cx);
        let degrees = Math.round(((a - startAngle) * 180) / Math.PI) + startRotation;
        if (!ev.shiftKey) {
          // Snap to 15-degree increments when shift is NOT held.
          degrees = Math.round(degrees / 15) * 15;
        }
        // Normalise to [-180, 180]
        while (degrees > 180) degrees -= 360;
        while (degrees < -180) degrees += 360;
        updateAttributes({ rotation: degrees });
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [editable, rotation, updateAttributes],
  );

  // ---- Drag the image body to reposition (behind / front only) -------

  /** Threshold in pixels the cursor must travel before pointerdown is
   *  interpreted as a drag.  Below this, the event propagates so
   *  Tiptap can select the node (which is what reveals the resize
   *  handles). */
  const DRAG_THRESHOLD = 6;

  /** Move the current node to the ProseMirror position under the
   *  given viewport coords.  Used by drop-anchor wrap modes
   *  (`wrap` and `break`) to re-anchor on pointerup. */
  const moveNodeToCoords = useCallback(
    (clientX: number, clientY: number) => {
      const view = editor.view;
      const target = view.posAtCoords({ left: clientX, top: clientY });
      if (!target) return;
      const getPos = props.getPos;
      if (typeof getPos !== "function") return;
      const myPos = getPos();
      if (typeof myPos !== "number") return;
      const node = view.state.doc.nodeAt(myPos);
      if (!node) return;
      const nodeSize = node.nodeSize;
      // Walk up to top-level (depth 1) so the image becomes a sibling
      // of the containing block, not a child of an inline node.
      const $target = view.state.doc.resolve(target.pos);
      const insertAtRaw = $target.depth === 0 ? target.pos : $target.before(1);
      // Don't no-op-move (would trigger an unnecessary transaction
      // and re-render that clobbers selection).
      if (insertAtRaw >= myPos && insertAtRaw <= myPos + nodeSize) return;
      // When inserting after our own position, the index shifts left
      // by the size of the removed node.
      const insertAt = insertAtRaw > myPos ? insertAtRaw - nodeSize : insertAtRaw;

      let tr = view.state.tr.delete(myPos, myPos + nodeSize);
      tr = tr.insert(insertAt, node);
      view.dispatch(tr);
    },
    [editor, props.getPos],
  );

  const startDrag = useCallback(
    (e: ReactPointerEvent) => {
      if (!editable) return;
      // Resize / rotate / wrap-menu handles have their own
      // pointerdown handlers and run before the wrapper's bubble
      // handler.  Skip drag when the press lands on one of them.
      if ((e.target as HTMLElement).closest(`.${styles.handle}, .${styles.rotateHandle}, .${styles.wrapToolbar}`)) {
        return;
      }
      const wrapper = containerRef.current;
      const img = imgRef.current;
      if (!wrapper || !img) return;
      const startCX = e.clientX;
      const startCY = e.clientY;
      const startLeft = wrapper.offsetLeft;
      const startTop = wrapper.offsetTop;
      const imgRect = img.getBoundingClientRect();
      const grabX = startCX - imgRect.left;
      const grabY = startCY - imgRect.top;
      let activated = false;
      let lastCX = startCX;
      let lastCY = startCY;

      const onMove = (ev: PointerEvent) => {
        lastCX = ev.clientX;
        lastCY = ev.clientY;
        const dx = ev.clientX - startCX;
        const dy = ev.clientY - startCY;
        if (!activated) {
          if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
          activated = true;
        }
        if (freePosition) {
          updateAttributes({ x: startLeft + dx, y: startTop + dy });
        } else {
          const { zone, rect: sideZoneRect } = computeSideZone(editor, ev.clientX);
          const indicator = computeDropIndicator(editor, props.getPos, ev.clientX, ev.clientY);
          setDropState({
            ghost: {
              left: ev.clientX - grabX,
              top: ev.clientY - grabY,
              width: imgRect.width,
              height: imgRect.height,
              src,
              rotation,
            },
            indicator,
            sideZone: zone,
            sideZoneRect,
          });
        }
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        setDropState(null);
        if (!activated || freePosition) return;
        const { zone } = computeSideZone(editor, lastCX);
        if (zone === "left") {
          updateAttributes({ wrap: "wrap", x: null, y: null });
        } else if (zone === "right") {
          updateAttributes({ wrap: "wrapRight", x: null, y: null });
        }
        moveNodeToCoords(lastCX, lastCY);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [editable, freePosition, moveNodeToCoords, updateAttributes, editor, props.getPos, src, rotation],
  );

  // ---- Wrap-mode menu -----------------------------------------------------

  const setWrap = useCallback(
    (mode: ImageWrapMode) => {
      // Entering a free-position mode (behind / front): always seed
      // x/y from the wrapper's current offsetLeft / offsetTop so the
      // image stays where the user expects, regardless of what x/y
      // were stored from a previous session.
      if (mode === "behind" || mode === "front") {
        const wrapper = containerRef.current;
        if (wrapper) {
          updateAttributes({ wrap: mode, x: wrapper.offsetLeft, y: wrapper.offsetTop });
          return;
        }
      }
      // Leaving a free-position mode: clear x/y so the image picks
      // up the in-flow layout cleanly.
      updateAttributes({ wrap: mode, x: null, y: null });
    },
    [updateAttributes],
  );

  return (
    <NodeViewWrapper
      ref={containerRef}
      className={`${styles.wrapper} ${styles[`wrap_${wrap}`]} ${showChrome ? styles.selected : ""} ${draggable ? styles.draggable : ""}`}
      data-wrap={wrap}
      style={containerStyle}
      onPointerDown={draggable ? startDrag : undefined}
      // Tiptap sets `draggable: true` on the node spec, which makes
      // the browser launch native HTML5 drag on mousedown.  That
      // cancels our pointermove stream (the pointer gets reassigned
      // to the drag operation).  Suppress native drag in the
      // absolutely-positioned modes so our pointer-based drag can
      // run; the in-flow modes still allow HTML5 drag for moving
      // the node into a different paragraph via ProseMirror's drop
      // handling.
      onDragStart={draggable ? (e: React.DragEvent) => e.preventDefault() : undefined}
      draggable={draggable ? false : undefined}
    >
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        style={imgStyle}
        className={styles.img}
        draggable={false}
      />

      {showChrome && (
        <>
          {/* 8 resize handles */}
          {HANDLES.map((h) => (
            <span
              key={h.id}
              className={`${styles.handle} ${styles[h.cls]}`}
              onPointerDown={(e) => startResize(h.id, e)}
              aria-hidden="true"
            />
          ))}

          {/* Rotate handle */}
          <span
            className={styles.rotateHandle}
            style={{ top: `-${ROTATE_HANDLE_OFFSET}px` }}
            onPointerDown={startRotate}
            title={t("liveDoc.image.rotate")}
            aria-label={t("liveDoc.image.rotate")}
          >
            <RefreshCwIcon width={14} height={14} />
          </span>


        </>
      )}

      {dropState && createPortal(<DropPreview state={dropState} />, document.body)}

      {showChrome && createPortal(
        <div
          ref={wrapToolbarRef}
          className={styles.wrapToolbar}
          role="toolbar"
          aria-label={t("liveDoc.image.wrapLabel")}
        >
          {IMAGE_WRAP_MODES.map((m) => (
            <button
              key={m}
              type="button"
              className={`${styles.wrapBtn} ${wrap === m ? styles.wrapBtnActive : ""}`}
              onClick={(ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                setWrap(m);
              }}
              onMouseDown={(ev) => ev.preventDefault()}
              title={wrapLabel(m, t)}
              aria-label={wrapLabel(m, t)}
              aria-pressed={wrap === m}
            >
              <WrapIcon mode={m} />
              <span className={styles.wrapBtnLabel}>{wrapLabel(m, t)}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </NodeViewWrapper>
  );
}

function DropPreview({ state }: { readonly state: DropDragState }) {
  const { ghost, indicator, sideZone, sideZoneRect } = state;
  return (
    <>
      <img
        src={ghost.src}
        alt=""
        className={styles.dragGhost}
        style={{
          left: `${ghost.left}px`,
          top: `${ghost.top}px`,
          width: `${ghost.width}px`,
          height: `${ghost.height}px`,
          transform: ghost.rotation ? `rotate(${ghost.rotation}deg)` : undefined,
        }}
      />
      {indicator && (
        <span
          className={styles.dropIndicator}
          style={{
            left: `${indicator.left}px`,
            top: `${indicator.top}px`,
            width: `${indicator.width}px`,
          }}
          aria-hidden="true"
        />
      )}
      {sideZone && sideZoneRect && (
        <span
          className={styles.sideZoneIndicator}
          style={{
            left: `${sideZoneRect.left}px`,
            top: `${sideZoneRect.top}px`,
            width: `${sideZoneRect.width}px`,
            height: `${sideZoneRect.height}px`,
          }}
          aria-hidden="true"
        />
      )}
    </>
  );
}



