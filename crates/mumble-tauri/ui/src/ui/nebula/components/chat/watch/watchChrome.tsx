import { useEffect, useState } from "react";
import { Box } from "@mui/material";
import type { Theme } from "@mui/material/styles";

import { radius } from "../../../tokens";

/**
 * The pieces the mini player and the theater player share.
 *
 * Two surfaces, one vocabulary: the same controls sit on a panel in the corner
 * and on glass over a full-width video, so every control here comes in a
 * panel form and a glass form rather than being written twice.
 */

/** A control that sits on the panel. */
export function iconBtn(theme: Theme, active = false) {
  return {
    all: "unset",
    boxSizing: "border-box",
    flex: "none",
    width: 26,
    height: 26,
    borderRadius: "7px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    color: active ? theme.palette.nebula.text : theme.palette.nebula.muted,
    background: active ? theme.palette.nebula.card2 : "transparent",
    "&:hover": { background: theme.palette.nebula.card2, color: theme.palette.nebula.text },
    "&:focus-visible": { outline: "2px solid " + theme.palette.nebula.accent, outlineOffset: 1 },
  } as const;
}

/** The same control over video, where the panel's tokens would disappear. */
export function iconBtnGlass(active = false) {
  return {
    all: "unset",
    boxSizing: "border-box",
    flex: "none",
    width: 26,
    height: 26,
    borderRadius: "7px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    color: active ? "#ffffff" : "#dfe4ec",
    background: active ? "rgba(255,255,255,.18)" : "transparent",
    "&:hover": { background: "rgba(255,255,255,.16)", color: "#ffffff" },
    "&:focus-visible": { outline: "2px solid rgba(255,255,255,.7)", outlineOffset: 1 },
  } as const;
}

/** A labelled pill - speed, the layout switch, the sync lock. */
export function pill(theme: Theme, glass: boolean, active = false) {
  if (glass) {
    return {
      all: "unset",
      boxSizing: "border-box",
      flex: "none",
      display: "inline-flex",
      alignItems: "center",
      gap: "4px",
      height: 26,
      px: "8px",
      borderRadius: "7px",
      fontSize: 10.5,
      fontWeight: 500,
      cursor: "pointer",
      color: active ? "#ffffff" : "#dfe4ec",
      background: active ? "rgba(255,255,255,.18)" : "transparent",
      "&:hover": { background: "rgba(255,255,255,.16)" },
      "&:focus-visible": { outline: "2px solid rgba(255,255,255,.7)", outlineOffset: 1 },
    } as const;
  }
  return {
    all: "unset",
    boxSizing: "border-box",
    flex: "none",
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    height: 26,
    px: "8px",
    borderRadius: "7px",
    fontSize: 11,
    fontWeight: 500,
    cursor: "pointer",
    color: active ? theme.palette.nebula.accent : theme.palette.nebula.muted,
    background: active ? theme.palette.nebula.accentSoft : "transparent",
    "&:hover": { background: theme.palette.nebula.card2 },
    "&:focus-visible": { outline: "2px solid " + theme.palette.nebula.accent, outlineOffset: 1 },
  } as const;
}

/** `m:ss`, or `h:mm:ss` past the hour. Zero for anything not yet known. */
export function clock(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

/** Where a click landed along an element, 0 to 1. */
export function ratioAt(event: { clientX: number; currentTarget: HTMLElement }): number {
  const box = event.currentTarget.getBoundingClientRect();
  if (box.width <= 0) return 0;
  return Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
}

/**
 * The rect of an element, kept current.
 *
 * The player is one fixed surface that hovers over whichever layout is showing
 * -- see `WatchDock` - so it has to know where that layout's slot is, through
 * resizes, scrolls and the switch between the two.
 */
export function useSlotRect(element: HTMLElement | null): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!element) {
      setRect(null);
      return;
    }
    const read = () => setRect(element.getBoundingClientRect());
    read();
    // Capture on scroll: the pane scrolls, not the window, and a scroll event
    // from a nested scroller does not bubble.
    window.addEventListener("scroll", read, true);
    window.addEventListener("resize", read);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(read);
    observer?.observe(element);
    return () => {
      window.removeEventListener("scroll", read, true);
      window.removeEventListener("resize", read);
      observer?.disconnect();
    };
  }, [element]);

  return rect;
}

/**
 * The seek bar: buffered behind, played in front, a knob on the played edge.
 *
 * Read-only for anyone who is not the host - they follow, and a scrub the next
 * sync would undo is a lie about who is in charge.
 */
export function SeekBar({
  current,
  total,
  buffered,
  glass,
  onSeek,
  label,
}: Readonly<{
  current: number;
  total: number;
  buffered: number;
  glass: boolean;
  onSeek?: (seconds: number) => void;
  label: string;
}>) {
  const played = total > 0 ? Math.min(100, (current / total) * 100) : 0;
  const ahead = total > 0 ? Math.min(100, (buffered / total) * 100) : 0;
  const seekable = !!onSeek && total > 0;

  return (
    <Box
      role={seekable ? "slider" : undefined}
      tabIndex={seekable ? 0 : undefined}
      aria-label={seekable ? label : undefined}
      aria-valuemin={seekable ? 0 : undefined}
      aria-valuemax={seekable ? Math.round(total) : undefined}
      aria-valuenow={seekable ? Math.round(current) : undefined}
      onClick={seekable ? (event) => onSeek(ratioAt(event) * total) : undefined}
      sx={{
        position: "relative",
        height: 10,
        display: "flex",
        alignItems: "center",
        cursor: seekable ? "pointer" : "default",
        "&:hover .wt-knob": { opacity: seekable ? 1 : 0 },
      }}
    >
      <Box
        sx={(theme) => ({
          position: "absolute",
          left: 0,
          right: 0,
          height: 4,
          borderRadius: "3px",
          background: glass ? "rgba(255,255,255,.2)" : theme.palette.nebula.card2,
          overflow: "hidden",
        })}
      >
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            width: `${ahead}%`,
            background: glass ? "rgba(255,255,255,.28)" : "rgba(255,255,255,.12)",
          }}
        />
        <Box
          sx={(theme) => ({
            position: "absolute",
            inset: 0,
            width: `${played}%`,
            background: glass ? "#ffffff" : theme.palette.nebula.accent,
          })}
        />
      </Box>
      <Box
        className="wt-knob"
        sx={(theme) => ({
          position: "absolute",
          left: `${played}%`,
          width: 10,
          height: 10,
          ml: "-5px",
          borderRadius: "50%",
          background: glass ? "#ffffff" : theme.palette.nebula.accent,
          opacity: 0,
          transition: "opacity .12s ease",
          pointerEvents: "none",
        })}
      />
    </Box>
  );
}

/** The volume control: a button that opens its slider on hover. */
export function VolumeControl({
  volume,
  muted,
  glass,
  onToggleMute,
  onSetVolume,
  muteLabel,
  volumeLabel,
}: Readonly<{
  volume: number;
  muted: boolean;
  glass: boolean;
  onToggleMute: () => void;
  onSetVolume: (value: number) => void;
  muteLabel: string;
  volumeLabel: string;
}>) {
  const [open, setOpen] = useState(false);
  const level = muted ? 0 : volume;

  return (
    <Box
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      sx={{ display: "flex", alignItems: "center", gap: "3px", flex: "none" }}
    >
      <Box
        component="button"
        type="button"
        aria-label={muteLabel}
        onClick={onToggleMute}
        sx={(theme) => (glass ? iconBtnGlass() : iconBtn(theme))}
      >
        <VolumeIcon level={level} />
      </Box>
      <Box
        role="slider"
        tabIndex={0}
        aria-label={volumeLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(level * 100)}
        onClick={(event) => onSetVolume(ratioAt(event))}
        sx={{
          position: "relative",
          height: 12,
          width: open ? 54 : 0,
          opacity: open ? 1 : 0,
          overflow: "hidden",
          cursor: "pointer",
          transition: "width .14s ease, opacity .14s ease",
          display: "flex",
          alignItems: "center",
        }}
      >
        <Box
          sx={(theme) => ({
            position: "absolute",
            inset: 0,
            my: "auto",
            height: 4,
            borderRadius: "3px",
            background: glass ? "rgba(255,255,255,.22)" : theme.palette.nebula.card2,
          })}
        />
        <Box
          sx={(theme) => ({
            position: "absolute",
            left: 0,
            my: "auto",
            height: 4,
            width: `${level * 100}%`,
            borderRadius: "3px",
            background: glass ? "#ffffff" : theme.palette.nebula.accent,
          })}
        />
      </Box>
    </Box>
  );
}

function VolumeIcon({ level }: Readonly<{ level: number }>) {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M3 5.4h1.9L7.4 3.3v7.4L4.9 8.6H3z" strokeLinejoin="round" />
      {level > 0 && <path d="M9.4 5.4a2.3 2.3 0 0 1 0 3.2" strokeLinecap="round" />}
      {level > 0.5 && <path d="M10.9 3.9a4.4 4.4 0 0 1 0 6.2" strokeLinecap="round" />}
      {level === 0 && <path d="M9.6 5.6l2.8 2.8M12.4 5.6l-2.8 2.8" strokeLinecap="round" />}
    </svg>
  );
}

/** The playback-speed menu, opened from the speed pill. */
export function SpeedMenu({
  rates,
  current,
  glass,
  onPick,
  heading,
}: Readonly<{
  rates: readonly number[];
  current: number;
  glass: boolean;
  onPick: (rate: number) => void;
  heading: string;
}>) {
  return (
    <Box
      sx={(theme) => ({
        position: "absolute",
        right: 9,
        bottom: glass ? 52 : 9,
        width: glass ? 140 : 126,
        maxHeight: "calc(100% - 18px)",
        overflow: "auto",
        borderRadius: radius("md"),
        p: "4px",
        zIndex: 5,
        background: glass ? "rgba(14,18,28,.92)" : theme.palette.nebula.tint + "," + theme.palette.nebula.bg0,
        border: "1px solid " + (glass ? "rgba(255,255,255,.1)" : theme.palette.nebula.line2),
        boxShadow: glass ? "0 16px 40px rgba(0,0,0,.45)" : theme.palette.nebula.shadow,
        backdropFilter: "blur(18px)",
      })}
    >
      <Box
        sx={(theme) => ({
          px: "8px",
          pt: "5px",
          pb: "3px",
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: ".07em",
          color: glass ? "#8f97a5" : theme.palette.nebula.dim,
        })}
      >
        {heading}
      </Box>
      {rates.map((rate) => (
        <Box
          key={rate}
          component="button"
          type="button"
          onClick={() => onPick(rate)}
          sx={(theme) => ({
            all: "unset",
            boxSizing: "border-box",
            display: "flex",
            alignItems: "center",
            width: "100%",
            px: "8px",
            height: 26,
            borderRadius: "7px",
            fontSize: 11.5,
            cursor: "pointer",
            color: glass ? "#e9ecf3" : theme.palette.nebula.text,
            "&:hover": { background: glass ? "rgba(255,255,255,.1)" : theme.palette.nebula.card2 },
          })}
        >
          {rate === 1 ? "Normal" : `${rate}×`}
          <Box component="span" sx={{ ml: "auto", color: "inherit" }}>
            {Math.abs(rate - current) < 0.001 ? "✓" : ""}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
