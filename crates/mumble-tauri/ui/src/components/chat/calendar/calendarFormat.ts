/**
 * Locale-aware display helpers for the calendar (kept separate from the pure
 * date math in `calendarDates.ts`). Uses the browser locale / `Intl`, matching
 * the rest of the app's local-time rendering.
 */

import type { CSSProperties } from "react";
import type { CalendarEvent, CalendarView } from "./types";
import { addDays, startOfDay, startOfWeek } from "./calendarDates";

/** `09:30` / `9:30 AM` per the user's locale. */
export function shortTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Monday-first short weekday names (`Mon … Sun`) in the user's locale. */
export function weekdayShortNames(): string[] {
  // 2024-01-01 is a Monday; format that week.
  const monday = startOfWeek(new Date(2024, 0, 1).getTime());
  const fmt = new Intl.DateTimeFormat([], { weekday: "short" });
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(addDays(monday, i))));
}

/** The viewing user's effective colour for an event (personal override wins). */
export function eventColor(event: CalendarEvent): string {
  return event.personalColor ?? event.color;
}

/**
 * Pick black or white text for legibility on a given background colour, using
 * the WCAG relative-luminance formula. Light backgrounds (e.g. white) get dark
 * text; dark backgrounds get white text.
 */
export function readableTextColor(hex: string): string {
  const c = hex.replace("#", "").trim();
  const full = c.length === 3 ? c.split("").map((ch) => ch + ch).join("") : c;
  if (full.length < 6) return "#ffffff";
  const channel = (i: number) => {
    const v = Number.parseInt(full.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  return luminance > 0.5 ? "#1b1d23" : "#ffffff";
}

function hexToRgba(hex: string, alpha: number): string {
  const c = hex.replace("#", "").trim();
  const full = c.length === 3 ? c.split("").map((ch) => ch + ch).join("") : c;
  const r = Number.parseInt(full.slice(0, 2), 16) || 0;
  const g = Number.parseInt(full.slice(2, 4), 16) || 0;
  const b = Number.parseInt(full.slice(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Visual treatment for an event block, derived from the viewing user's RSVP
 * (`myStatus`) and free/busy ("Show as", `showAs`):
 *  - declined  -> hidden (removed from the grid)
 *  - tentative (RSVP or show-as) -> semi-opaque
 *  - free      -> very light fill + thin border
 *  - busy      -> normal solid fill
 *  - working elsewhere -> dashed border
 *  - out of office     -> red dotted border
 */
export function eventVisualStyle(event: CalendarEvent): { hidden: boolean; style: CSSProperties } {
  if (event.myStatus === "declined") return { hidden: true, style: {} };
  const color = eventColor(event);
  const showAs = event.showAs ?? "busy";
  const style: CSSProperties = {};

  const text = readableTextColor(color);
  if (showAs === "free") {
    style.background = hexToRgba(color, 0.16);
    style.color = "var(--color-text-primary)";
    style.border = `1px solid ${hexToRgba(color, 0.7)}`;
    style.borderLeft = `1px solid ${hexToRgba(color, 0.7)}`;
  } else {
    style.background = color;
    style.color = text;
  }

  if (showAs === "workingElsewhere") {
    // Bold diagonal stripes so it clearly reads as "not at my desk".
    const stripe = hexToRgba(text, 0.38);
    style.background = `repeating-linear-gradient(45deg, transparent 0 7px, ${stripe} 7px 14px), ${color}`;
    style.border = `2px dotted ${hexToRgba(text, 0.8)}`;
  } else if (showAs === "away") {
    // Strong amber wash + dashed amber outline.
    style.background = `linear-gradient(rgba(245, 166, 35, 0.34), rgba(245, 166, 35, 0.34)), ${color}`;
    style.border = "3px dashed #f5a623";
    style.color = text;
  } else if (showAs === "oof") {
    // Strong red wash + thick red dotted outline.
    style.background = `linear-gradient(rgba(255, 77, 79, 0.36), rgba(255, 77, 79, 0.36)), ${color}`;
    style.border = "3px dotted #ff4d4f";
    style.color = text;
  }

  if (event.myStatus === "tentative" || showAs === "tentative") {
    style.opacity = 0.55;
  }
  return { hidden: false, style };
}

/** Human-readable date/time range for an occurrence. */
export function formatRange(start: number, end: number, allDay: boolean): string {
  const day = (ms: number) =>
    new Intl.DateTimeFormat([], { weekday: "short", day: "numeric", month: "short" }).format(
      new Date(ms),
    );
  if (allDay) {
    const lastDay = end - 1;
    return startOfDay(start) === startOfDay(lastDay)
      ? day(start)
      : `${day(start)} – ${day(lastDay)}`;
  }
  if (startOfDay(start) === startOfDay(end)) {
    return `${day(start)} · ${shortTime(start)} – ${shortTime(end)}`;
  }
  return `${day(start)} ${shortTime(start)} – ${day(end)} ${shortTime(end)}`;
}

/** Toolbar range label for the current view + anchor (e.g. "March 2026"). */
export function rangeLabel(view: CalendarView, anchor: number): string {
  const d = new Date(anchor);
  if (view === "month") {
    return new Intl.DateTimeFormat([], { month: "long", year: "numeric" }).format(d);
  }
  if (view === "day") {
    return new Intl.DateTimeFormat([], {
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(d);
  }
  // week / workweek: "3 – 9 Mar 2026" (collapse shared month/year).
  const start = startOfWeek(anchor);
  const days = view === "workweek" ? 5 : 7;
  const end = addDays(start, days - 1);
  const ds = new Date(start);
  const de = new Date(end);
  const sameMonth = ds.getMonth() === de.getMonth() && ds.getFullYear() === de.getFullYear();
  const dayFmt = new Intl.DateTimeFormat([], { day: "numeric" });
  const tailFmt = new Intl.DateTimeFormat([], { day: "numeric", month: "short", year: "numeric" });
  return sameMonth ? `${dayFmt.format(ds)} – ${tailFmt.format(de)}` : `${tailFmt.format(ds)} – ${tailFmt.format(de)}`;
}
