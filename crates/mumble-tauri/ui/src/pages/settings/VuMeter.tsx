import { useEffect, useRef, useState } from "react";
import styles from "./SettingsPage.module.css";

/** Peak-hold decay: percentage-points per second (along the dB axis). */
const PEAK_DECAY_PER_SEC = 60;

/** VU meter dB axis: anything quieter than this collapses to the left edge. */
export const VU_DB_MIN = -60;
/** Right edge of the VU meter axis (full-scale digital audio). */
export const VU_DB_MAX = 0;

/** Map a linear amplitude (0-1) to a 0-100 percentage on the dB axis. */
export function linearToVuPercent(amplitude: number): number {
  if (amplitude <= 0) return 0;
  const db = 20 * Math.log10(amplitude);
  const pct = ((db - VU_DB_MIN) / (VU_DB_MAX - VU_DB_MIN)) * 100;
  return Math.max(0, Math.min(100, pct));
}

/** Inverse of {@link linearToVuPercent}: maps 0-100 back to linear amplitude. */
export function vuPercentToLinear(pct: number): number {
  const clamped = Math.max(0, Math.min(100, pct));
  const db = VU_DB_MIN + ((VU_DB_MAX - VU_DB_MIN) * clamped) / 100;
  return Math.pow(10, db / 20);
}

export type VuMarkerVariant = "open" | "close";

export interface VuMarker {
  value: number;
  variant: VuMarkerVariant;
  title?: string;
  /** Set to make the marker draggable via a triangle handle above the meter. */
  onChange?: (next: number) => void;
  /** Accessible name for the overlay slider. Required when `onChange` is set. */
  ariaLabel?: string;
}

interface VuMeterProps {
  rms: number;
  peak: number;
  /** Legacy single-marker prop, used when no `markers` array is supplied. */
  threshold?: number;
  /** Colored markers projected onto the VU track. */
  markers?: readonly VuMarker[];
  /** Highlights the meter when current RMS would open the noise gate. */
  talking?: boolean;
}

export function VuMeter({
  rms,
  peak,
  threshold,
  markers,
  talking,
}: Readonly<VuMeterProps>) {
  const fillRef = useRef<HTMLDivElement>(null);
  const peakRef = useRef<HTMLDivElement>(null);
  const heldPeakPct = useRef(0);
  const lastTime = useRef(performance.now());
  const rafId = useRef(0);
  const [activeDrag, setActiveDrag] = useState(-1);

  useEffect(() => {
    const now = performance.now();
    const dt = (now - lastTime.current) / 1000;
    lastTime.current = now;

    const peakPercent = linearToVuPercent(peak);
    heldPeakPct.current = Math.max(0, heldPeakPct.current - PEAK_DECAY_PER_SEC * dt);
    if (peakPercent > heldPeakPct.current) {
      heldPeakPct.current = peakPercent;
    }

    cancelAnimationFrame(rafId.current);
    rafId.current = requestAnimationFrame(() => {
      if (fillRef.current) fillRef.current.style.width = `${linearToVuPercent(rms)}%`;
      if (peakRef.current) peakRef.current.style.left = `${heldPeakPct.current}%`;
    });

    return () => cancelAnimationFrame(rafId.current);
  }, [rms, peak]);

  const resolvedMarkers: VuMarker[] =
    markers && markers.length > 0
      ? [...markers]
      : threshold !== undefined
        ? [{ value: threshold, variant: "open", title: `Threshold: ${(threshold * 100).toFixed(1)}%` }]
        : [];

  const draggableMarkers = resolvedMarkers.filter((m) => m.onChange);
  const hasDraggable = draggableMarkers.length > 0;

  function pickClosest(e: React.PointerEvent<HTMLDivElement>): number {
    const rect = e.currentTarget.getBoundingClientRect();
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    let closest = 0;
    let minDist = Infinity;
    draggableMarkers.forEach((m, i) => {
      const dist = Math.abs(linearToVuPercent(m.value) - xPct);
      if (dist < minDist) { minDist = dist; closest = i; }
    });
    return closest;
  }

  function applyDrag(e: React.PointerEvent<HTMLDivElement>, idx: number) {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    draggableMarkers[idx]?.onChange?.(vuPercentToLinear(pct));
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const idx = pickClosest(e);
    setActiveDrag(idx);
    e.currentTarget.setPointerCapture(e.pointerId);
    applyDrag(e, idx);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (activeDrag < 0) return;
    e.preventDefault();
    applyDrag(e, activeDrag);
  }

  function handlePointerUp() {
    setActiveDrag(-1);
  }

  return (
    <div className={styles.vuMeter}>
      <div className={`${styles.vuTrack} ${talking ? styles.vuTrackActive : ""}`}>
        <div className={styles.vuFill} ref={fillRef} />
        <div className={styles.vuPeak} ref={peakRef} />
        {resolvedMarkers.map((m, i) => (
          <div
            key={`marker-${m.variant}-${i}`}
            className={`${styles.vuThreshold} ${m.variant === "close" ? styles.vuThresholdClose : styles.vuThresholdOpen}`}
            style={{ left: `${linearToVuPercent(m.value)}%` }}
            title={m.title}
          />
        ))}
        {draggableMarkers.map((m, i) => (
          <div
            key={`handle-${m.variant}-${i}`}
            className={`${styles.vuHandle} ${m.variant === "close" ? styles.vuHandleClose : styles.vuHandleOpen}`}
            style={{ left: `${linearToVuPercent(m.value)}%` }}
          />
        ))}
        {draggableMarkers.map((m, i) => (
          <input
            key={`range-${m.variant}-${i}`}
            type="range"
            className={styles.vuRangeOverlay}
            min="0"
            max="100"
            step="0.1"
            value={linearToVuPercent(m.value)}
            aria-label={m.ariaLabel}
            onChange={(e) => m.onChange?.(vuPercentToLinear(parseFloat(e.target.value)))}
          />
        ))}
        {hasDraggable && (
          <div
            className={`${styles.vuDragLayer} ${activeDrag >= 0 ? styles.vuDragActive : ""}`}
            role="presentation"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          />
        )}
      </div>
      <div className={styles.vuLabels}>
        <span>-60</span>
        <span>-40</span>
        <span>-20</span>
        <span>0 dB</span>
      </div>
    </div>
  );
}
