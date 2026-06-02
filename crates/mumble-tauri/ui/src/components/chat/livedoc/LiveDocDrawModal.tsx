/**
 * LiveDocDrawModal - a basic freehand drawing surface for the ribbon's
 * Draw tab.  The user sketches on a white canvas; on insert the canvas is
 * exported to a PNG `File` and handed to the existing image pipeline
 * (`insertEditorImage`), so a drawing behaves exactly like any other inline
 * image - it syncs, persists and exports with the document.  No new Yjs
 * node type is introduced.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import styles from "./LiveDocDrawModal.module.css";

const CANVAS_W = 640;
const CANVAS_H = 400;

interface LiveDocDrawModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Receives the finished drawing as a PNG file for insertion. */
  readonly onInsert: (file: File) => void;
}

export default function LiveDocDrawModal({ open, onClose, onInsert }: LiveDocDrawModalProps) {
  const { t } = useTranslation("chat");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  const [color, setColor] = useState("#1a1a1a");
  const [width, setWidth] = useState(3);
  const colorRef = useRef(color);
  const widthRef = useRef(width);
  colorRef.current = color;
  widthRef.current = width;

  // Paint a fresh white background whenever the modal (re)opens so the
  // exported PNG reads as ink-on-paper on any theme.
  const clear = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, []);

  useEffect(() => {
    if (open) clear();
  }, [open, clear]);

  // Close on Escape while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const pointAt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    // Map CSS pixels to the canvas' intrinsic pixel grid.
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    lastRef.current = pointAt(e);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    const last = lastRef.current;
    if (!ctx || !last) return;
    const next = pointAt(e);
    ctx.strokeStyle = colorRef.current;
    ctx.lineWidth = widthRef.current;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(next.x, next.y);
    ctx.stroke();
    lastRef.current = next;
  };

  const endStroke = () => {
    drawingRef.current = false;
    lastRef.current = null;
  };

  const insert = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], "drawing.png", { type: "image/png" });
      onInsert(file);
      onClose();
    }, "image/png");
  }, [onInsert, onClose]);

  if (!open) return null;

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label={t("liveDoc.draw.title", { defaultValue: "Insert drawing" })}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.dialog}>
        <div className={styles.title}>{t("liveDoc.draw.title", { defaultValue: "Insert drawing" })}</div>
        <div className={styles.tools}>
          <label className={styles.tool}>
            {t("liveDoc.draw.color", { defaultValue: "Color" })}
            <input
              type="color"
              className={styles.colorInput}
              value={color}
              onChange={(e) => setColor(e.target.value)}
              aria-label={t("liveDoc.draw.color", { defaultValue: "Color" })}
            />
          </label>
          <label className={styles.tool}>
            {t("liveDoc.draw.brushSize", { defaultValue: "Brush" })}
            <input
              type="range"
              min={1}
              max={24}
              value={width}
              onChange={(e) => setWidth(Number(e.target.value))}
              aria-label={t("liveDoc.draw.brushSize", { defaultValue: "Brush" })}
            />
          </label>
        </div>
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          width={CANVAS_W}
          height={CANVAS_H}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
          onPointerLeave={endStroke}
        />
        <div className={styles.actions}>
          <button type="button" className={styles.btn} onClick={clear}>
            {t("liveDoc.draw.clear", { defaultValue: "Clear" })}
          </button>
          <span className={styles.spacer} />
          <button type="button" className={styles.btn} onClick={onClose}>
            {t("liveDoc.draw.cancel", { defaultValue: "Cancel" })}
          </button>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={insert}>
            {t("liveDoc.draw.insert", { defaultValue: "Insert" })}
          </button>
        </div>
      </div>
    </div>
  );
}
