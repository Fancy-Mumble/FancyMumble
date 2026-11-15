import type { DateFormat, NumberFormat } from "@core/types";
﻿import type { TimeFormat } from "../types";

// -- Duration / uptime ---------------------------------------------

/** Format a number of seconds into a compact human-readable string showing
 *  only the two most significant units (e.g. "2d 5h", "1h 23m", "3m 12s"). */
export function formatDuration(totalSeconds: number): string {
  const d = Math.floor(totalSeconds / 86400);
  const h = Math.floor((totalSeconds % 86400) / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (parts.length === 0 || s > 0) parts.push(`${s}s`);
  return parts.slice(0, 2).join(" ");
}

// -- Bandwidth -----------------------------------------------------

/** Format a bandwidth value (bits/s) into a human-readable string. */
export function formatBandwidth(bitsPerSec: number): string {
  if (bitsPerSec >= 1_000_000) {
    return `${(bitsPerSec / 1_000_000).toFixed(1)} Mbit/s`;
  }
  if (bitsPerSec >= 1_000) {
    return `${(bitsPerSec / 1_000).toFixed(0)} kbit/s`;
  }
  return `${bitsPerSec} bit/s`;
}

// -- Byte sizes ----------------------------------------------------

/** Human-readable byte count using binary (IEC) units, e.g. `512 MiB`.
 *  `null`/`undefined` (an unknown size) formats as an empty string; `0` and
 *  invalid values format as `0 B`. */
export function formatBytes(n: number | null | undefined): string {
  if (n == null) return "";
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  if (n < 1024) return `${Math.round(n)} B`;
  const units = ["KiB", "MiB", "GiB", "TiB", "PiB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const digits = v >= 10 || Number.isInteger(v) ? 0 : 1;
  // A size is under 1024 of its unit: its decimal mark is the reader's,
  // and it is not split into thousands.
  return `${formatNumber(digits ? v : Math.round(v), digits, false)} ${units[i]}`;
}

// -- Numbers and dates as the reader chose (Settings, Language & format) --

/** The locale whose marks each number format names. */
const NUMBER_LOCALES: Record<Exclude<NumberFormat, "auto">, string> = {
  "comma-period": "en-US",
  "period-comma": "de-DE",
  "space-comma": "fr-FR",
};

let numberFormatInForce: NumberFormat = "auto";
let dateFormatInForce: DateFormat = "auto";

/**
 * How numbers and dates are written from now on: the Language & format
 * page's choices, set where the preferences are read and again whenever they
 * change, so that a formatter called anywhere need not be handed them.
 */
export function setNumberAndDateFormat(numberFormat?: NumberFormat, dateFormat?: DateFormat): void {
  numberFormatInForce = numberFormat ?? "auto";
  dateFormatInForce = dateFormat ?? "auto";
}

/** `value` with `fractionDigits` places, in the number format in force. */
export function formatNumber(value: number, fractionDigits = 0, grouping = true): string {
  const locale = numberFormatInForce === "auto" ? undefined : NUMBER_LOCALES[numberFormatInForce];
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
    useGrouping: grouping,
  }).format(value);
}

/**
 * What the rule over a day of messages says of a day before yesterday: its
 * weekday and date, the date in the date format in force. "Auto" is the
 * short weekday, day and month the conversation has always shown.
 */
export function formatDayLabel(date: Date): string {
  const weekday = date.toLocaleDateString(undefined, { weekday: "short" });
  const pad = (n: number) => String(n).padStart(2, "0");
  const [d, m, y] = [pad(date.getDate()), pad(date.getMonth() + 1), String(date.getFullYear())];
  switch (dateFormatInForce) {
    case "dmy":
      return `${weekday}, ${d}/${m}/${y}`;
    case "mdy":
      return `${weekday}, ${m}/${d}/${y}`;
    case "ymd":
      return `${weekday}, ${y}-${m}-${d}`;
    default:
      return date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  }
}

// -- Timestamp -----------------------------------------------------

/**
 * Format a Unix-epoch-millis timestamp into a short time string.
 *
 * @param epochMs       - Timestamp value (always epoch milliseconds).
 * @param timeFormat    - "12h", "24h", or "auto" (follow OS setting).
 * @param localTime     - When true, display in local timezone (default).
 *                        When false, display in UTC.
 * @param systemUses24h - OS-reported clock format for "auto" mode. When
 *   provided, bypasses the unreliable WebView2 Intl probe on Windows.
 */
/**
 * One formatter per way of writing a clock, built the first time it is wanted.
 *
 * `toLocaleTimeString` builds a formatter internally on every call, and this is
 * called for every message in the river, twice - once for the row and once for
 * the block's travelling stamp - on every render of the list. Constructing a
 * few hundred `Intl.DateTimeFormat`s per render is most of what "formatting the
 * timestamps" costs; reusing four of them is the whole fix.
 */
const clocks = new Map<string, Intl.DateTimeFormat>();

/** Whether this machine's own clock is a 24-hour one, asked once. */
let systemHour12: boolean | null = null;

function systemPrefersHour12(): boolean {
  if (systemHour12 === null) {
    const resolved = new Intl.DateTimeFormat([], { hour: "numeric" }).resolvedOptions();
    systemHour12 = resolved.hour12 ?? (resolved.hourCycle !== "h23" && resolved.hourCycle !== "h24");
  }
  return systemHour12;
}

export function formatTimestamp(
  epochMs: number,
  timeFormat: TimeFormat = "auto",
  localTime = true,
  systemUses24h?: boolean,
): string {
  const hour12 =
    timeFormat === "12h"
      ? true
      : timeFormat === "24h"
        ? false
        : systemUses24h !== undefined
          ? !systemUses24h
          : systemPrefersHour12();

  const key = `${hour12 ? 12 : 24}:${localTime ? "local" : "utc"}`;
  let clock = clocks.get(key);
  if (!clock) {
    clock = new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12,
      ...(localTime ? {} : { timeZone: "UTC" }),
    });
    clocks.set(key, clock);
  }
  return clock.format(epochMs);
}

/** Forget the cached formatters. Only the tests, which change the locale. */
export function resetClockCacheForTests(): void {
  clocks.clear();
  systemHour12 = null;
}

// -- Avatar colour -------------------------------------------------

const AVATAR_COLORS = ["#2AABEE", "#7c3aed", "#22c55e", "#f59e0b", "#ef4444", "#ec4899"];

/** Deterministic colour for a username (stable hash into a palette). */
export function colorFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (name.codePointAt(i) ?? 0) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// -- Date chip -----------------------------------------------------

/**
 * Return a calendar-date key ("YYYY-MM-DD") for an epoch-millis timestamp.
 * Uses the local timezone when `localTime` is true, otherwise UTC.
 */
export function dateKey(epochMs: number, localTime = true): string {
  const d = new Date(epochMs);
  if (!localTime) {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Format a date for the date-change chip in the chat view.
 * Returns "Today", "Yesterday", or a long date like "March 15, 2026".
 */
/**
 * Format a date string (e.g. "2024-03-15T10:30:00") as a compact relative
 * label such as "3d ago", "2mo ago", etc.  Falls back to the raw string
 * if it cannot be parsed.
 */
export function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) return "just now";

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;

  const years = Math.floor(months / 12);
  return `${years}y ago`;
}

export function formatDateChip(epochMs: number, localTime = true): string {
  const d = new Date(epochMs);
  const now = new Date();

  const toDay = (date: Date, local: boolean) =>
    local
      ? new Date(date.getFullYear(), date.getMonth(), date.getDate())
      : new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

  const target = toDay(d, localTime);
  const today = toDay(now, localTime);
  const diffMs = today.getTime() - target.getTime();
  const diffDays = Math.round(diffMs / 86_400_000);

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";

  const opts: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "long",
    day: "numeric",
    ...(localTime ? {} : { timeZone: "UTC" }),
  };
  return d.toLocaleDateString(undefined, opts);
}
