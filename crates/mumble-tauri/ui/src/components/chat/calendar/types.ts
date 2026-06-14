/**
 * Calendar domain types (client-side).
 *
 * Mirrors what the `fancy-calendar` plugin relays and what each user persists
 * to their file-server personal store. Timestamps are UTC epoch milliseconds;
 * the UI renders them in the user's local time.
 */

/** Which grid the calendar panel is showing. */
export type CalendarView = "day" | "workweek" | "week" | "month";

/** Recurrence frequency presets (plus `custom` for an interval+unit rule). */
export type RepeatFreq =
  | "none"
  | "weekdays"
  | "daily"
  | "weekly"
  | "monthly"
  | "yearly"
  | "custom";

/** Custom-recurrence unit. */
export type RepeatUnit = "day" | "week" | "month" | "year";

export interface RepeatRule {
  readonly freq: RepeatFreq;
  /** For `custom`: repeat every `interval` `unit`s. */
  readonly interval?: number;
  readonly unit?: RepeatUnit;
  /** Optional series end (UTC ms), inclusive; `null`/undefined = forever. */
  readonly until?: number | null;
}

/** A participant's response to an invite. */
export type RsvpStatus = "invited" | "accepted" | "declined" | "tentative";

/** How the meeting shows on the user's free/busy (Outlook-style "Show as"). */
export type ShowAs =
  | "free"
  | "tentative"
  | "busy"
  | "away"
  | "workingElsewhere"
  | "oof";

export const SHOW_AS_OPTIONS: readonly ShowAs[] = [
  "free",
  "tentative",
  "busy",
  "away",
  "workingElsewhere",
  "oof",
];

/** Minutes-before-start to remind; `null` = do not notify. */
export type ReminderMinutes = number | null;

export interface Participant {
  readonly userId: number;
  readonly name: string;
  readonly status: RsvpStatus;
}

export interface CalendarEvent {
  readonly id: string;
  readonly organizerId: number;
  readonly organizerName: string;
  readonly title: string;
  readonly location: string;
  /** Rich-text description as tiptap-produced HTML. */
  readonly description: string;
  /** Inclusive start (UTC ms). For all-day, local midnight of the first day. */
  readonly start: number;
  /** Exclusive end (UTC ms). For all-day, local midnight after the last day. */
  readonly end: number;
  readonly allDay: boolean;
  /** IANA zone id the meeting's times are expressed in (Windows-style picker). */
  readonly timezone?: string;
  readonly repeat: RepeatRule;
  /** Default chip colour (hex, e.g. `#2aabee`). */
  readonly color: string;
  readonly participants: readonly Participant[];
  /** The viewing user's personal reminder offset. */
  readonly reminderMinutes: ReminderMinutes;
  /** The viewing user's RSVP response (right-click → accept/tentative/decline). */
  readonly myStatus?: RsvpStatus;
  /** The viewing user's free/busy "Show as" for this meeting. */
  readonly showAs?: ShowAs;
  /** The viewing user's personal colour override (hex) or null. */
  readonly personalColor?: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** Free/busy availability kinds. */
export type AvailabilityKind = "free" | "busy" | "tentative" | "ooo";

export interface AvailabilityBlock {
  readonly id: string;
  readonly userId: number;
  readonly start: number;
  readonly end: number;
  readonly kind: AvailabilityKind;
  readonly repeat: RepeatRule;
}

/** Per-user working hours; the time grid shades these slots lighter. */
export interface WorkHours {
  readonly enabled: boolean;
  /** Minutes from local midnight (e.g. 9:00 = 540). */
  readonly startMinutes: number;
  readonly endMinutes: number;
  /** Working days, Monday-first (index 0 = Mon … 6 = Sun). */
  readonly days: readonly boolean[];
}

export const DEFAULT_WORK_HOURS: WorkHours = {
  enabled: true,
  startMinutes: 9 * 60,
  endMinutes: 17 * 60,
  days: [true, true, true, true, true, false, false],
};

/** A single rendered instance of a (possibly recurring) event. */
export interface EventOccurrence {
  readonly event: CalendarEvent;
  /** Occurrence start/end (UTC ms) for this instance. */
  readonly start: number;
  readonly end: number;
  /** Stable key for React lists (`${event.id}:${start}`). */
  readonly key: string;
}

/** Default palette offered in the colour picker / used for new events. */
export const CALENDAR_COLORS: readonly string[] = [
  "#2aabee",
  "#7c5cff",
  "#e0457b",
  "#f5a623",
  "#3bb273",
  "#e4572e",
  "#17a2b8",
  "#8e8e93",
];

/** Reminder offsets offered in the dropdown (minutes; `null` = none). */
export const REMINDER_OPTIONS: readonly ReminderMinutes[] = [
  null,
  0,
  5,
  10,
  15,
  30,
  60,
  120,
  1440,
];
