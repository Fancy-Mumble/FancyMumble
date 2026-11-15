/**
 * The strip a composer shows in place of its text field while a voice
 * message is being recorded: discard, a pulsing dot, the time against the
 * server's ceiling, the live input level, and send.
 */

import { useTranslation } from "react-i18next";
import {
  formatClipTime,
  LIVE_BARS,
  type VoiceRecorderState,
} from "@core/features/chat/voice/useVoiceRecorder";
import { SendIcon, TrashIcon } from "../../../icons";
import styles from "./VoiceMessage.module.css";

export interface VoiceRecorderBarProps {
  readonly state: VoiceRecorderState;
  /** The server's ceiling in milliseconds, 0 for none. */
  readonly limitMs: number;
  readonly onCancel: () => void;
  readonly onSend: () => void;
  /** Off where the host's own Send button sends the take instead. */
  readonly showSend?: boolean;
}

export default function VoiceRecorderBar({
  state,
  limitMs,
  onCancel,
  onSend,
  showSend = true,
}: VoiceRecorderBarProps) {
  const { t } = useTranslation("chat");
  const recording = state.phase === "recording" ? state : null;
  const sending = state.phase === "sending";
  const elapsed = recording?.elapsedMs ?? 0;
  const levels = recording?.levels ?? [];
  // Right-aligned and padded, so the newest level is always at the send end
  // and the strip does not grow as the take does.
  const padded = [...Array.from({ length: Math.max(0, LIVE_BARS - levels.length) }, () => 0), ...levels];

  return (
    <div
      className={styles.recorder}
      role="group"
      aria-label={t("voiceMessage.recording")}
      data-testid="voice-recorder"
    >
      <button
        type="button"
        className={styles.discard}
        onClick={onCancel}
        disabled={sending}
        aria-label={t("voiceMessage.cancel")}
      >
        <TrashIcon size={16} />
      </button>
      <span className={`${styles.dot} ${recording?.limitReached || sending ? styles.dotStill : ""}`} />
      <span className={styles.time} aria-live="off">
        {formatClipTime(elapsed)}
        {limitMs > 0 ? ` / ${formatClipTime(limitMs)}` : ""}
      </span>
      <div className={styles.live} aria-hidden>
        {padded.map((level, index) => (
          <span
            // A fixed number of slots; the index is the slot.
            key={index}
            className={styles.bar}
            style={{ height: `${Math.max(10, Math.min(100, Math.sqrt(level) * 180))}%` }}
          />
        ))}
      </div>
      {recording?.limitReached && <span className={styles.limit}>{t("voiceMessage.limitReached")}</span>}
      {sending && <span className={styles.limit}>{t("voiceMessage.sending")}</span>}
      {showSend && (
        <button
          type="button"
          className={styles.round}
          onClick={onSend}
          disabled={sending || state.phase === "starting"}
          aria-label={t("voiceMessage.send")}
          data-testid="voice-recorder-send"
        >
          <SendIcon size={16} />
        </button>
      )}
    </div>
  );
}
