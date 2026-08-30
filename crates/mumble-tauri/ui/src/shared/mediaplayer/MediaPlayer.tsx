/**
 * One player for sound and video, drawn by us rather than by the platform.
 *
 * Every webview draws its own native controls: GTK, WebKit and WebView2 each
 * at their own size, in their own colours, with their own idea of which
 * buttons exist. The same attachment therefore looked like three different
 * things depending on who opened it, and when a fetch failed one of them
 * simply wrote "Error" across the timeline with nothing to do about it.
 *
 * So the element keeps the decoding and loses the chrome (`controls` is never
 * set), and everything visible here is ours: the same shape everywhere, and
 * able to say what went wrong and offer to try again - which for a shared
 * file is usually the whole fix, because the link it was reading has aged out
 * rather than the file having gone.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import styles from "./MediaPlayer.module.css";

export interface MediaPlayerProps {
  readonly src: string;
  /** Sound has no picture, so its controls are the whole player. */
  readonly kind: "audio" | "video";
  /** Named for the screen reader, since there is no visible label. */
  readonly label: string;
  /** Asked for a fresh source when a load fails. Without one, Retry reloads. */
  readonly onRetry?: () => void;
  readonly className?: string;
}

/** The speeds the rate button steps through. */
const RATES = [1, 1.25, 1.5, 2, 0.5] as const;

/** `m:ss`, or `h:mm:ss` once there is an hour to show. */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  const s = whole % 60;
  const m = Math.floor(whole / 60) % 60;
  const h = Math.floor(whole / 3600);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Where along a rail a pointer landed, as 0..1. */
export function fractionAt(clientX: number, rail: DOMRect): number {
  if (rail.width <= 0) return 0;
  return Math.min(1, Math.max(0, (clientX - rail.left) / rail.width));
}

export default function MediaPlayer({ src, kind, label, onRetry, className }: MediaPlayerProps) {
  const media = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const scrubber = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [failed, setFailed] = useState(false);
  /** True until the first frame is worth showing a play button over. */
  const [untouched, setUntouched] = useState(true);
  const titleId = useId();

  // A new source is a new attempt: whatever failed last time is no longer
  // what this player is showing.
  useEffect(() => {
    setFailed(false);
    setUntouched(true);
    setCurrent(0);
    setDuration(0);
    setBuffered(0);
  }, [src]);

  const withMedia = useCallback((act: (element: HTMLMediaElement) => void) => {
    const element = media.current;
    if (element) act(element);
  }, []);

  const togglePlay = useCallback(() => {
    withMedia((element) => {
      setUntouched(false);
      if (element.paused) void element.play().catch(() => setFailed(true));
      else element.pause();
    });
  }, [withMedia]);

  const seekTo = useCallback(
    (seconds: number) => {
      withMedia((element) => {
        if (!Number.isFinite(element.duration)) return;
        element.currentTime = Math.min(element.duration, Math.max(0, seconds));
      });
    },
    [withMedia],
  );

  const seekToFraction = useCallback(
    (fraction: number) => {
      withMedia((element) => {
        if (Number.isFinite(element.duration)) element.currentTime = element.duration * fraction;
      });
    },
    [withMedia],
  );

  // Dragging continues outside the rail, the way every scrubber does: the
  // pointer is captured so leaving the element does not drop the drag.
  const onScrub = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const rail = scrubber.current?.getBoundingClientRect();
      if (!rail) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      seekToFraction(fractionAt(event.clientX, rail));
    },
    [seekToFraction],
  );

  const onScrubMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      const rail = scrubber.current?.getBoundingClientRect();
      if (rail) seekToFraction(fractionAt(event.clientX, rail));
    },
    [seekToFraction],
  );

  const onScrubKey = useCallback(
    (event: React.KeyboardEvent) => {
      // Read the element rather than the rendered state: `timeupdate` fires
      // about four times a second, so two quick presses would both be
      // measured from the same stale position and the second would undo most
      // of the first.
      const element = media.current;
      if (!element) return;
      const step = event.shiftKey ? 30 : 5;
      if (event.key === "ArrowRight") seekTo(element.currentTime + step);
      else if (event.key === "ArrowLeft") seekTo(element.currentTime - step);
      else if (event.key === "Home") seekTo(0);
      else if (event.key === "End") seekTo(element.duration);
      else if (event.key === " " || event.key === "Enter") togglePlay();
      else return;
      event.preventDefault();
    },
    [seekTo, togglePlay],
  );

  const retry = useCallback(() => {
    setFailed(false);
    if (onRetry) {
      onRetry();
      return;
    }
    // No fresh source on offer, so ask for the same one again: a span that
    // failed once often answers on the second attempt.
    withMedia((element) => element.load());
  }, [onRetry, withMedia]);

  const cycleRate = useCallback(() => {
    const next = RATES[(RATES.indexOf(rate as (typeof RATES)[number]) + 1) % RATES.length] ?? 1;
    setRate(next);
    withMedia((element) => {
      element.playbackRate = next;
    });
  }, [rate, withMedia]);

  const toggleMuted = useCallback(() => {
    withMedia((element) => {
      element.muted = !element.muted;
      setMuted(element.muted);
    });
  }, [withMedia]);

  const changeVolume = useCallback(
    (fraction: number) => {
      withMedia((element) => {
        element.volume = fraction;
        element.muted = fraction === 0;
        setVolume(fraction);
        setMuted(element.muted);
      });
    },
    [withMedia],
  );

  const onTimeUpdate = useCallback(() => {
    withMedia((element) => {
      setCurrent(element.currentTime);
      const ranges = element.buffered;
      setBuffered(ranges.length > 0 ? ranges.end(ranges.length - 1) : 0);
    });
  }, [withMedia]);

  const played = duration > 0 ? current / duration : 0;
  const loaded = duration > 0 ? Math.min(1, buffered / duration) : 0;

  const bar = (
    <div
      className={`${styles.controls} ${kind === "audio" ? styles.controlsStatic : ""} ${
        playing ? "" : styles.controlsPinned
      }`}
    >
      <button
        type="button"
        className={styles.button}
        onClick={togglePlay}
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <span className={styles.time}>{formatTime(current)}</span>
      <div
        ref={scrubber}
        className={styles.scrubber}
        role="slider"
        tabIndex={0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(current)}
        aria-valuetext={`${formatTime(current)} of ${formatTime(duration)}`}
        onPointerDown={onScrub}
        onPointerMove={onScrubMove}
        onKeyDown={onScrubKey}
      >
        <div className={styles.rail}>
          <div className={styles.buffered} style={{ width: `${loaded * 100}%` }} />
          <div className={styles.played} style={{ width: `${played * 100}%` }} />
        </div>
        <span className={styles.knob} style={{ left: `${played * 100}%` }} />
      </div>
      <span className={styles.time}>{formatTime(duration)}</span>
      <button type="button" className={styles.rate} onClick={cycleRate} aria-label="Playback speed">
        {rate}&times;
      </button>
      <div className={styles.volume}>
        <button
          type="button"
          className={styles.button}
          onClick={toggleMuted}
          aria-label={muted ? "Unmute" : "Mute"}
        >
          {muted || volume === 0 ? <MutedIcon /> : <SoundIcon />}
        </button>
        <input
          className={styles.volumeRail}
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={muted ? 0 : volume}
          onChange={(event) => changeVolume(Number(event.target.value))}
          aria-label="Volume"
        />
      </div>
      {kind === "video" && (
        <button
          type="button"
          className={styles.button}
          onClick={() => withMedia((element) => void element.requestFullscreen?.())}
          aria-label="Full screen"
        >
          <ExpandIcon />
        </button>
      )}
    </div>
  );

  const failure = (
    <div className={`${styles.failure} ${kind === "audio" ? styles.failureInline : ""}`}>
      <span className={styles.failureText}>
        This file stopped loading. The link it was reading may have expired.
      </span>
      <button type="button" className={styles.retry} onClick={retry}>
        Try again
      </button>
    </div>
  );

  return (
    <div className={`${styles.player} ${className ?? ""}`} aria-labelledby={titleId}>
      <span id={titleId} hidden>
        {label}
      </span>
      {kind === "video" ? (
        <video
          ref={media}
          className={styles.video}
          src={src}
          preload="metadata"
          playsInline
          onClick={togglePlay}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={onTimeUpdate}
          onProgress={onTimeUpdate}
          onDurationChange={() => withMedia((element) => setDuration(element.duration || 0))}
          onLoadedMetadata={() => withMedia((element) => setDuration(element.duration || 0))}
          onError={() => setFailed(true)}
        >
          <track kind="captions" />
        </video>
      ) : (
        <div className={styles.audioBody}>
          <audio
            ref={media}
            src={src}
            preload="metadata"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={onTimeUpdate}
            onProgress={onTimeUpdate}
            onDurationChange={() => withMedia((element) => setDuration(element.duration || 0))}
            onLoadedMetadata={() => withMedia((element) => setDuration(element.duration || 0))}
            onError={() => setFailed(true)}
          >
            <track kind="captions" />
          </audio>
          {failed ? failure : bar}
        </div>
      )}
      {kind === "video" && !failed && untouched && !playing && (
        <button type="button" className={styles.poster} onClick={togglePlay} aria-label={`Play ${label}`}>
          <span className={styles.posterDisc}>
            <PlayIcon size={22} />
          </span>
        </button>
      )}
      {kind === "video" && !failed && bar}
      {kind === "video" && failed && failure}
    </div>
  );
}

/* ---- Icons, inline so the player carries no dependency of its own ---- */

function PlayIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5.14v13.72a1 1 0 0 0 1.54.84l10.3-6.86a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="6" y="4.5" width="4" height="15" rx="1.2" />
      <rect x="14" y="4.5" width="4" height="15" rx="1.2" />
    </svg>
  );
}

function SoundIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M11 5 6 9H3v6h3l5 4z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
    </svg>
  );
}

function MutedIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M11 5 6 9H3v6h3l5 4z" />
      <path d="m16 9 5 6M21 9l-5 6" />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
    </svg>
  );
}
