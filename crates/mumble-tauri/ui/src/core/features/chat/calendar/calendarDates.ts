/**
 * Small local-time date helpers for the calendar grids.
 *
 * All public timestamps are UTC epoch ms; these helpers operate in the
 * browser's local timezone (which is what the user sees), mirroring how the
 * rest of the app formats time via `utils/format`.
 */

export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;

/** Local midnight (00:00) of the day containing `ms`. */
export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Add `n` whole days (DST-safe via local Date arithmetic). */
export function addDays(ms: number, n: number): number {
  const d = new Date(ms);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

export function addMonths(ms: number, n: number): number {
  const d = new Date(ms);
  d.setMonth(d.getMonth() + n);
  return d.getTime();
}

export function addYears(ms: number, n: number): number {
  const d = new Date(ms);
  d.setFullYear(d.getFullYear() + n);
  return d.getTime();
}

/** Monday-based weekday index: Mon=0 … Sun=6. */
export function isoWeekday(ms: number): number {
  return (new Date(ms).getDay() + 6) % 7;
}

/** Local midnight of the Monday on or before `ms`. */
export function startOfWeek(ms: number): number {
  return addDays(startOfDay(ms), -isoWeekday(ms));
}

/** Local midnight of the first day of the month containing `ms`. */
export function startOfMonth(ms: number): number {
  const d = new Date(ms);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function isSameDay(a: number, b: number): boolean {
  return startOfDay(a) === startOfDay(b);
}

export function isToday(ms: number): boolean {
  return isSameDay(ms, Date.now());
}

/** Combine a local day (ms) and a `HH:mm` string into a UTC-ms timestamp. */
export function withTime(dayMs: number, hhmm: string): number {
  const [h, m] = hhmm.split(":").map((s) => Number.parseInt(s, 10));
  const d = new Date(startOfDay(dayMs));
  d.setHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0);
  return d.getTime();
}

/** `YYYY-MM-DD` for a `<input type="date">` (local). */
export function toDateInput(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

/** `HH:mm` for a `<input type="time">` (local). */
export function toTimeInput(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Parse a `<input type="date">` value to local-midnight UTC ms. */
export function fromDateInput(value: string): number {
  const [y, mo, da] = value.split("-").map((s) => Number.parseInt(s, 10));
  const d = new Date();
  d.setFullYear(y, (mo || 1) - 1, da || 1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** The 6×7 grid of day-starts covering the month that contains `anchor`. */
export function monthGridDays(anchor: number): number[] {
  const first = startOfWeek(startOfMonth(anchor));
  return Array.from({ length: 42 }, (_, i) => addDays(first, i));
}

/** The `count` consecutive day-starts beginning at `startDay`. */
export function daySpan(startDay: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => addDays(startDay, i));
}
