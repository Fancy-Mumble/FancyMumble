/**
 * The decisions the scheduled-messages dialog makes, kept pure so they can be
 * tested without a store, a clock or a webview.
 */
import { ScheduleStatus, type ScheduledMessage } from "@core/store/slices/scheduled";
import type { ChannelEntry } from "@core/types";
import { formatTime, type TimeDisplay } from "../../../selectors";

/** How far ahead the time field starts: soon enough to be the likely answer,
 *  far enough that it is not already past by the time the message is typed. */
export const DEFAULT_LEAD_MS = 5 * 60 * 1000;

/** A `datetime-local` value for `epochMs`, in local time at minute resolution. */
export function toLocalInputValue(epochMs: number): string {
  const d = new Date(epochMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export type DeliveryCheck = { ok: true; deliverAt: number } | { ok: false; reason: "invalid" | "past" };

/**
 * Whether a `datetime-local` value is a time the server can deliver at.
 *
 * Checked here rather than left to the server, which would accept a past time
 * and deliver at once - the opposite of what scheduling was for.
 */
export function checkDelivery(value: string, now: number): DeliveryCheck {
  const deliverAt = new Date(value).getTime();
  if (!value || Number.isNaN(deliverAt)) return { ok: false, reason: "invalid" };
  if (deliverAt <= now) return { ok: false, reason: "past" };
  return { ok: true, deliverAt };
}

/** The messages still waiting, soonest first. The list the server reports keeps
 *  delivered and cancelled ones too, and has no order of its own. */
export function pendingScheduled(messages: readonly ScheduledMessage[]): ScheduledMessage[] {
  return messages
    .filter((message) => message.status === ScheduleStatus.Pending)
    .sort((a, b) => (a.deliverAt ?? Infinity) - (b.deliverAt ?? Infinity));
}

/** The channels a scheduled message goes to, by name where the tree still has them. */
export function scheduledTargets(message: ScheduledMessage, channels: readonly ChannelEntry[]): string {
  return [...message.channelIds, ...message.treeIds]
    .map((id) => channels.find((channel) => channel.id === id)?.name ?? `#${id}`)
    .join(", ");
}

/**
 * When a scheduled message goes out, as a row says it.
 *
 * A clock alone for today, because that is all a reader needs; a date as well
 * past today, because "14:05" on a message due next week reads as this
 * afternoon. The clock honours the 12/24-hour setting the conversation does.
 */
export function deliveryLabel(epochMs: number | undefined, time: TimeDisplay, now: number): string {
  if (!epochMs) return "";
  const clock = formatTime(epochMs, time);
  const due = new Date(epochMs);
  if (due.toDateString() === new Date(now).toDateString()) return clock;
  const sameYear = due.getFullYear() === new Date(now).getFullYear();
  const date = due.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  return `${date} ${clock}`;
}
