/**
 * The calendar's small decisions that are Nebula's rather than the calendar's:
 * how a card placed from nowhere is told apart, which occurrence a room stands
 * for, how a reminder offset is worded. Pure, so the tests can ask directly.
 */
import type { CSSProperties } from "react";
import type { TFunction } from "i18next";
import type { AnchorRect } from "@core/features/chat/calendar/calendarStore";
import { eventVisualStyle } from "@core/features/chat/calendar/calendarFormat";
import { MS_PER_DAY } from "@core/features/chat/calendar/calendarDates";
import { expandEvent } from "@core/features/chat/calendar/recurrence";
import type {
  CalendarEvent,
  CalendarView,
  ReminderMinutes,
  RsvpStatus,
} from "@core/features/chat/calendar/types";

export const VIEW_ORDER: readonly CalendarView[] = ["day", "workweek", "week", "month"];

export const RSVP_CHOICES: readonly { status: RsvpStatus; key: "accept" | "tentative" | "decline" }[] = [
  { status: "accepted", key: "accept" },
  { status: "tentative", key: "tentative" },
  { status: "declined", key: "decline" },
];

/**
 * The anchor for a card opened from somewhere that is not a block on the grid -
 * a reminder, a meeting room's header. There is nothing to sit beside, so the
 * card centres itself.
 */
export const UNANCHORED: AnchorRect = { top: 0, left: 0, right: 0, bottom: 0 };

export function isUnanchored(rect: AnchorRect): boolean {
  return rect.top === 0 && rect.left === 0 && rect.right === 0 && rect.bottom === 0;
}

/** Days in a grid of this view. */
export function dayCountFor(view: CalendarView): 1 | 5 | 7 {
  if (view === "day") return 1;
  return view === "workweek" ? 5 : 7;
}

/**
 * Which occurrence a meeting stands for right now: the one under way, else the
 * next one, else the series' first.
 *
 * A room is joined for a meeting, not for a date, so a card opened from a room
 * has to pick the instance - and the one you are sitting in is the one you mean.
 */
export function currentOccurrence(event: CalendarEvent, now: number): number {
  const ahead = expandEvent(event, now - MS_PER_DAY, now + 366 * MS_PER_DAY);
  return ahead.find((occ) => occ.end > now)?.start ?? event.start;
}

export function reminderLabel(t: TFunction<"chat">, minutes: ReminderMinutes): string {
  if (minutes === null) return t("calendar.reminders.none");
  if (minutes === 0) return t("calendar.reminders.atStart");
  if (minutes < 60) return t("calendar.reminders.minutes", { count: minutes });
  if (minutes < 1440) return t("calendar.reminders.hours", { count: Math.round(minutes / 60) });
  return t("calendar.reminders.days", { count: Math.round(minutes / 1440) });
}

/**
 * A meeting block's fill, from the shared RSVP and show-as rules.
 *
 * The one colour those rules leave to a stylesheet - the text on a "free"
 * block, which sits on a pale wash - names Standard's variable, which Nebula
 * does not define; it takes the window's text colour instead.
 */
export function eventBlockStyle(event: CalendarEvent, text: string): CSSProperties {
  const { style } = eventVisualStyle(event);
  return style.color?.toString().startsWith("var(") ? { ...style, color: text } : style;
}
