/**
 * ScheduledMessagesPanel - a chat-splitting side panel to schedule a text
 * message for future delivery to the current channel and manage the
 * caller's pending scheduled messages. The server stores and delivers the
 * message; this panel only invokes the scheduled-message store actions and
 * renders the `AppState` slice they feed (`core/store/slices/scheduled.ts`).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@core/store";
import { TID } from "@core/testids";
import { ScheduleStatus, type ScheduledMessage } from "@core/store/slices/scheduled";
import { ClockIcon, SendIcon, TrashIcon, RefreshCwIcon } from "../../../icons";
import styles from "./ScheduledMessagesPanel.module.css";

interface ScheduledMessagesPanelProps {
  readonly channelId: number;
}

function formatTime(ms?: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString();
}

/** "YYYY-MM-DDTHH:mm" in local time, 5 minutes from now, for the default input value. */
function defaultLocalDateTime(): string {
  const d = new Date(Date.now() + 5 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ScheduledMessagesPanel({ channelId }: ScheduledMessagesPanelProps) {
  const { t } = useTranslation("chat");
  const channels = useAppStore((s) => s.channels);
  const channelName = channels.find((c) => c.id === channelId)?.name;

  const messages = useAppStore((s) => s.scheduledMessages);
  const loading = useAppStore((s) => s.scheduledLoading);
  const lastAck = useAppStore((s) => s.scheduledLastAck);
  const scheduleMessage = useAppStore((s) => s.scheduleMessage);
  const listScheduledMessages = useAppStore((s) => s.listScheduledMessages);
  const cancelScheduledMessage = useAppStore((s) => s.cancelScheduledMessage);

  const [body, setBody] = useState("");
  const [when, setWhen] = useState<string>(defaultLocalDateTime);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    void listScheduledMessages();
  }, [listScheduledMessages]);

  const pending = useMemo(() => messages.filter((m) => m.status === ScheduleStatus.Pending), [messages]);

  const statusLabel = useCallback(
    (status: number): string => {
      switch (status) {
        case ScheduleStatus.Delivered:
          return t("scheduled.statusDelivered");
        case ScheduleStatus.Cancelled:
          return t("scheduled.statusCancelled");
        case ScheduleStatus.Rejected:
          return t("scheduled.statusRejected");
        default:
          return t("scheduled.statusPending");
      }
    },
    [t],
  );

  const targetName = useCallback(
    (m: ScheduledMessage): string => {
      const ids = [...m.channelIds, ...m.treeIds];
      return ids.map((id) => channels.find((c) => c.id === id)?.name ?? `#${id}`).join(", ");
    },
    [channels],
  );

  const submit = useCallback(async () => {
    const text = body.trim();
    if (!text || submitting) return;
    const deliverAt = new Date(when).getTime();
    if (Number.isNaN(deliverAt)) {
      setLocalError(t("scheduled.invalidTime"));
      return;
    }
    if (deliverAt <= Date.now()) {
      setLocalError(t("scheduled.timeInPast"));
      return;
    }
    setLocalError(null);
    setSubmitting(true);
    try {
      await scheduleMessage([channelId], text, deliverAt);
      setBody("");
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }, [body, when, submitting, channelId, scheduleMessage, t]);

  const ackError =
    lastAck && lastAck.status === ScheduleStatus.Rejected
      ? lastAck.reason || t("scheduled.statusRejected")
      : null;

  return (
    <div className={styles.panel} data-testid={TID.scheduledPanel}>
      <div className={styles.header}>
        <ClockIcon width={18} height={18} />
        <span className={styles.title}>
          {t("scheduled.title")}
          {channelName ? ` · ${channelName}` : ""}
        </span>
        <button
          type="button"
          className={styles.iconBtn}
          data-testid={TID.scheduledRefresh}
          onClick={() => void listScheduledMessages()}
          title={t("scheduled.refresh")}
          aria-label={t("scheduled.refresh")}
        >
          <RefreshCwIcon width={16} height={16} />
        </button>
      </div>

      <div className={styles.composer}>
        <textarea
          className={styles.textarea}
          data-testid={TID.scheduledBodyInput}
          placeholder={t("scheduled.messagePlaceholder")}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
        />
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{t("scheduled.deliverAt")}</span>
          <input
            className={styles.input}
            type="datetime-local"
            data-testid={TID.scheduledTimeInput}
            value={when}
            onChange={(e) => setWhen(e.target.value)}
          />
        </label>
        {(localError || ackError) && (
          <div className={styles.error} data-testid={TID.scheduledError}>
            {localError ?? ackError}
          </div>
        )}
        <button
          type="button"
          className={styles.primaryBtn}
          data-testid={TID.scheduledSubmit}
          onClick={() => void submit()}
          disabled={submitting || !body.trim()}
        >
          <SendIcon width={15} height={15} />
          {t("scheduled.schedule")}
        </button>
      </div>

      <div className={styles.list}>
        {loading && pending.length === 0 && <div className={styles.empty}>{t("scheduled.loading")}</div>}
        {!loading && pending.length === 0 && (
          <div className={styles.empty} data-testid={TID.scheduledEmpty}>
            {t("scheduled.none")}
          </div>
        )}
        {pending.map((m) => (
          <div key={m.scheduleId} className={styles.item} data-testid={TID.scheduledItem}>
            <div className={styles.itemHead}>
              <span className={styles.itemTarget}>{targetName(m)}</span>
              <span className={styles.itemStatus}>{statusLabel(m.status)}</span>
              <button
                type="button"
                className={styles.iconBtn}
                data-testid={TID.scheduledItemCancel}
                onClick={() => void cancelScheduledMessage(m.scheduleId)}
                title={t("scheduled.cancel")}
                aria-label={t("scheduled.cancel")}
              >
                <TrashIcon width={14} height={14} />
              </button>
            </div>
            <div className={styles.itemBody}>{m.message}</div>
            <div className={styles.itemTime}>
              {t("scheduled.deliversAt", { time: formatTime(m.deliverAt) })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
