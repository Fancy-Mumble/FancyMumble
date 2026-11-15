/**
 * Typed dates and times in the user's chosen format.
 *
 * The meeting form takes dates and times as text rather than as the native
 * pickers, because a native picker follows the system locale and ignores the
 * format the user picked in settings. Both packs draw their own field; what
 * the text means is decided here. Values are exchanged as ISO `YYYY-MM-DD` and
 * 24-hour `HH:mm`.
 */

import type { DateFormat, TimeFormat } from "../../../types";

const pad = (n: number) => String(n).padStart(2, "0");

/** How an ISO date is shown in `format`. */
export function formatDateText(iso: string, format: DateFormat): string {
  const date = new Date(`${iso}T00:00:00Z`);
  const y = date.getUTCFullYear();
  const m = pad(date.getUTCMonth() + 1);
  const d = pad(date.getUTCDate());
  if (format === "dmy") return `${d}/${m}/${y}`;
  if (format === "mdy") return `${m}/${d}/${y}`;
  return `${y}-${m}-${d}`;
}

export function datePlaceholder(format: DateFormat): string {
  if (format === "dmy") return "DD/MM/YYYY";
  if (format === "mdy") return "MM/DD/YYYY";
  return "YYYY-MM-DD";
}

/** The ISO date typed text names, or null while it names none. */
export function parseDateText(text: string, format: DateFormat): string | null {
  if (!text.trim()) return null;
  let y: number;
  let m: number;
  let d: number;
  if (format === "dmy" || format === "mdy") {
    const parts = text.split("/");
    if (parts.length !== 3) return null;
    const [a, b, c] = parts.map((part) => Number.parseInt(part, 10));
    [d, m] = format === "dmy" ? [a, b] : [b, a];
    y = c;
  } else {
    // ymd and auto both read ISO.
    const parts = text.split("-");
    if (parts.length !== 3) return null;
    [y, m, d] = parts.map((part) => Number.parseInt(part, 10));
  }
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  // Round-trip through a Date so the 31st of February is refused.
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() + 1 !== m || check.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${pad(m)}-${pad(d)}`;
}

/** How a 24-hour `HH:mm` is shown in `format`. */
export function formatTimeText(hhmm: string, format: TimeFormat): string {
  const [rawH, rawM] = hhmm.split(":").map((part) => Number.parseInt(part, 10));
  const h = Number.isFinite(rawH) ? rawH : 0;
  const m = Number.isFinite(rawM) ? rawM : 0;
  if (format === "12h") return `${pad(h % 12 || 12)}:${pad(m)} ${h < 12 ? "AM" : "PM"}`;
  return `${pad(h)}:${pad(m)}`;
}

export function timePlaceholder(format: TimeFormat): string {
  return format === "12h" ? "HH:MM AM/PM" : "HH:MM";
}

/** The 24-hour `HH:mm` typed text names, or null while it names none. */
export function parseTimeText(text: string, format: TimeFormat): string | null {
  if (!text.trim()) return null;
  let h: number;
  let m: number;
  if (format === "12h") {
    const match = /^(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)$/.exec(text);
    if (!match) return null;
    h = Number.parseInt(match[1], 10);
    m = Number.parseInt(match[2], 10);
    const pm = match[3].toUpperCase() === "PM";
    if (h === 12) h = pm ? 12 : 0;
    else if (pm) h += 12;
  } else {
    const match = /^(\d{1,2}):(\d{2})$/.exec(text);
    if (!match) return null;
    h = Number.parseInt(match[1], 10);
    m = Number.parseInt(match[2], 10);
  }
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${pad(h)}:${pad(m)}`;
}
