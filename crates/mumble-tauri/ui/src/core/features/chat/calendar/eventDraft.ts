/**
 * Turning a filled-in meeting form into the event it describes.
 *
 * Each pack draws its own form; what the fields add up to - when an all-day
 * meeting ends, what an end before the start means, which name an invitee is
 * stored under - is decided once, here.
 */

import type { Participant } from "./types";
import { fromDateInput, MS_PER_HOUR, startOfDay, withTime } from "./calendarDates";

const ONE_DAY_MS = 86_400_000;

export interface DraftTimes {
  readonly allDay: boolean;
  /** ISO `YYYY-MM-DD`. */
  readonly startDate: string;
  /** 24-hour `HH:mm`; ignored for an all-day meeting. */
  readonly startTime: string;
  readonly endDate: string;
  readonly endTime: string;
}

/** `ms` rounded up to the next whole hour - where a new meeting starts. */
export function nextHour(ms: number): number {
  const d = new Date(ms);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d.getTime();
}

/**
 * The start and exclusive end the form names.
 *
 * An all-day meeting runs to the midnight after its last day. An end at or
 * before the start is read as a slip rather than refused, and becomes an hour
 * (or a day) after it.
 */
export function draftRange(times: DraftTimes): { start: number; end: number } {
  const startDay = fromDateInput(times.startDate);
  const endDay = fromDateInput(times.endDate);
  const start = times.allDay ? startOfDay(startDay) : withTime(startDay, times.startTime);
  let end = times.allDay ? startOfDay(endDay) + ONE_DAY_MS : withTime(endDay, times.endTime);
  if (end <= start) end = start + (times.allDay ? ONE_DAY_MS : MS_PER_HOUR);
  return { start, end };
}

/** The invitees as participants: anyone already invited keeps their response. */
export function draftParticipants(
  invitees: readonly number[],
  existing: readonly Participant[] | undefined,
  candidates: readonly { user_id: number; name: string }[],
): Participant[] {
  return invitees.map((userId) => {
    const prev = existing?.find((p) => p.userId === userId);
    return {
      userId,
      name: prev?.name ?? candidates.find((c) => c.user_id === userId)?.name ?? `#${userId}`,
      status: prev?.status ?? "invited",
    };
  });
}
