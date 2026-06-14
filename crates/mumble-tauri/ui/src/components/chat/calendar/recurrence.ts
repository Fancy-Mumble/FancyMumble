/**
 * Recurrence expansion: turn a (possibly repeating) event into the concrete
 * occurrences that fall within a `[windowStart, windowEnd)` range, so the grids
 * can render them. Kept intentionally simple (matches the `RepeatRule` presets);
 * a server-side mirror will reuse the same shape for reminder scheduling.
 */

import type { CalendarEvent, EventOccurrence, RepeatRule } from "./types";
import { addDays, addMonths, addYears, isoWeekday } from "./calendarDates";

/** Safety cap so a malformed/forever rule can't spin unbounded. */
const MAX_OCCURRENCES = 750;

/** Advance one step from `ms` according to `rule` (non-`custom` presets). */
function step(ms: number, rule: RepeatRule): number {
  switch (rule.freq) {
    case "daily":
      return addDays(ms, 1);
    case "weekly":
      return addDays(ms, 7);
    case "monthly":
      return addMonths(ms, 1);
    case "yearly":
      return addYears(ms, 1);
    case "custom": {
      const n = Math.max(1, rule.interval ?? 1);
      switch (rule.unit ?? "week") {
        case "day":
          return addDays(ms, n);
        case "week":
          return addDays(ms, 7 * n);
        case "month":
          return addMonths(ms, n);
        case "year":
          return addYears(ms, n);
      }
    }
    // "weekdays" advances day-by-day (skipping weekends below); "none" never steps.
    default:
      return addDays(ms, 1);
  }
}

/** True when `ms` is Mon–Fri (used by the `weekdays` preset). */
function isWeekday(ms: number): boolean {
  return isoWeekday(ms) < 5;
}

/**
 * Expand `event` into occurrences overlapping `[windowStart, windowEnd)`.
 * Non-recurring events yield 0 or 1 occurrence.
 */
export function expandEvent(
  event: CalendarEvent,
  windowStart: number,
  windowEnd: number,
): EventOccurrence[] {
  const duration = Math.max(0, event.end - event.start);
  const out: EventOccurrence[] = [];
  const push = (start: number) => {
    const end = start + duration;
    out.push({ event, start, end, key: `${event.id}:${start}` });
  };

  if (event.repeat.freq === "none") {
    if (event.start < windowEnd && event.end > windowStart) push(event.start);
    return out;
  }

  const until = event.repeat.until ?? Number.POSITIVE_INFINITY;
  let cursor = event.start;
  let guard = 0;
  while (cursor < windowEnd && cursor <= until && guard < MAX_OCCURRENCES) {
    guard += 1;
    const occEnd = cursor + duration;
    const visible = cursor < windowEnd && occEnd > windowStart;
    if (event.repeat.freq === "weekdays") {
      if (visible && isWeekday(cursor)) push(cursor);
      cursor = addDays(cursor, 1);
    } else {
      if (visible) push(cursor);
      cursor = step(cursor, event.repeat);
    }
  }
  return out;
}

/** Expand many events and return occurrences sorted by start. */
export function expandEvents(
  events: readonly CalendarEvent[],
  windowStart: number,
  windowEnd: number,
): EventOccurrence[] {
  const out: EventOccurrence[] = [];
  for (const e of events) out.push(...expandEvent(e, windowStart, windowEnd));
  out.sort((a, b) => a.start - b.start);
  return out;
}
