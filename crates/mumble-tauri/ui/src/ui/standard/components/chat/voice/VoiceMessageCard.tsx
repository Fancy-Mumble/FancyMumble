/**
 * A voice message, drawn as one: play, the clip's shape, its length.
 *
 * The waveform and the length are the sender's, carried in the marker, so the
 * note has its final size and shape before a byte of audio is fetched. The
 * audio itself streams from the loopback media origin like any other canon
 * attachment (see `useCanonPreview`).
 */

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import type { FileAttachmentInfo, VoiceNote } from "@core/features/chat/fileAttachments";
import { useCanonPreview } from "@core/features/chat/starlingFiles";
import { formatClipTime } from "@core/features/chat/voice/useVoiceRecorder";
import { PauseIcon, PlayIcon } from "../../../icons";
import styles from "./VoiceMessage.module.css";

/** Bars drawn for a note that carried no waveform of its own. */
const FLAT = Array.from({ length: 48 }, () => 24);

/** The speeds a click on the rate button cycles through. */
const RATES = [1, 1.5, 2] as const;

/** How far an arrow key moves the playhead. */
const STEP_MS = 5000;

export interface VoiceMessageCardProps {
  readonly info: FileAttachmentInfo & { readonly voice: VoiceNote };
}

export default function VoiceMessageCard({ info }: VoiceMessageCardProps) {
  const { t } = useTranslation("chat");
  const { src: canonSrc } = useCanonPreview(info);
  const src = canonSrc ?? (info.mode === "public" && info.url ? info.url : null);
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [rate, setRate] = useState<(typeof RATES)[number]>(1);
  const [failed, setFailed] = useState(false);

  // The stated length until the file says otherwise: a sender's clock and the
  // decoder can disagree by a frame, and the playhead must reach the end.
  const [durationMs, setDurationMs] = useState(info.voice.durationMs);
  const bars = info.voice.waveform.length > 0 ? info.voice.waveform : FLAT;
  const progress = durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0;

  useEffect(() => {
    if (audio.current) audio.current.playbackRate = rate;
  }, [rate]);

  const toggle = useCallback(() => {
    const element = audio.current;
    if (!element) return;
    if (element.paused) {
      element.play().catch(() => setFailed(true));
    } else {
      element.pause();
    }
  }, []);

  const seekTo = useCallback(
    (ms: number) => {
      const element = audio.current;
      const clamped = Math.max(0, Math.min(durationMs, ms));
      setPositionMs(clamped);
      if (element) element.currentTime = clamped / 1000;
    },
    [durationMs],
  );

  const onPointer = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const box = event.currentTarget.getBoundingClientRect();
      if (box.width <= 0) return;
      seekTo(((event.clientX - box.left) / box.width) * durationMs);
    },
    [durationMs, seekTo],
  );

  const onKey = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "ArrowRight") seekTo(positionMs + STEP_MS);
      else if (event.key === "ArrowLeft") seekTo(positionMs - STEP_MS);
      else if (event.key === "Home") seekTo(0);
      else if (event.key === "End") seekTo(durationMs);
      else if (event.key === " " || event.key === "Enter") toggle();
      else return;
      event.preventDefault();
    },
    [durationMs, positionMs, seekTo, toggle],
  );

  if (failed && !src) {
    return <div className={styles.unavailable}>{t("voiceMessage.unavailable")}</div>;
  }

  const shown = playing || positionMs > 0 ? positionMs : durationMs;
  return (
    <div
      className={styles.note}
      role="group"
      aria-label={t("voiceMessage.label")}
      data-testid="voice-message"
    >
      <button
        type="button"
        className={styles.round}
        onClick={toggle}
        disabled={!src}
        aria-label={playing ? t("voiceMessage.pause") : t("voiceMessage.play")}
      >
        {playing ? <PauseIcon size={16} /> : <PlayIcon size={16} style={{ marginLeft: 2 }} />}
      </button>
      <div
        className={styles.wave}
        role="slider"
        tabIndex={0}
        aria-label={t("voiceMessage.seek")}
        aria-valuemin={0}
        aria-valuemax={Math.round(durationMs / 1000)}
        aria-valuenow={Math.round(positionMs / 1000)}
        aria-valuetext={formatClipTime(positionMs)}
        onPointerDown={onPointer}
        onKeyDown={onKey}
      >
        {bars.map((bar, index) => (
          <span
            // Bars never reorder: the index is the bar.
            key={index}
            className={`${styles.bar} ${(index + 0.5) / bars.length <= progress ? styles.played : ""}`}
            style={{ height: `${Math.max(12, bar)}%` }}
          />
        ))}
      </div>
      <span className={styles.time}>{formatClipTime(shown)}</span>
      <button
        type="button"
        className={styles.quiet}
        onClick={() => setRate((current) => RATES[(RATES.indexOf(current) + 1) % RATES.length])}
        aria-label={t("voiceMessage.speed")}
      >
        {rate}×
      </button>
      {src && (
        <audio
          ref={audio}
          src={src}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setPositionMs(0);
          }}
          onTimeUpdate={(event) => setPositionMs(event.currentTarget.currentTime * 1000)}
          onLoadedMetadata={(event) => {
            const seconds = event.currentTarget.duration;
            if (Number.isFinite(seconds) && seconds > 0) setDurationMs(seconds * 1000);
            event.currentTarget.playbackRate = rate;
          }}
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}
