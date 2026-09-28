import { describe, expect, it } from "vitest";
import i18n from "@core/i18n";
import type { CalendarEvent } from "@core/features/chat/calendar/types";
import { currentOccurrence, eventBlockStyle, isUnanchored, reminderLabel, UNANCHORED } from "./calendarModel";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function meeting(extra: Partial<CalendarEvent> = {}): CalendarEvent {
  const start = new Date(2026, 8, 1, 10).getTime();
  return {
    id: "m",
    organizerId: 1,
    organizerName: "Sebi",
    title: "Standup",
    location: "",
    description: "",
    start,
    end: start + HOUR,
    allDay: false,
    repeat: { freq: "weekly" },
    color: "#2aabee",
    participants: [],
    reminderMinutes: null,
    createdAt: 0,
    updatedAt: 0,
    ...extra,
  };
}

describe("currentOccurrence", () => {
  const event = meeting();

  it("is the occurrence under way when there is one", () => {
    const thirdWeek = event.start + 14 * DAY;
    expect(currentOccurrence(event, thirdWeek + HOUR / 2)).toBe(thirdWeek);
  });

  it("is the next one between meetings", () => {
    expect(currentOccurrence(event, event.start + 2 * DAY)).toBe(event.start + 7 * DAY);
  });

  it("is the meeting itself once a one-off is over", () => {
    const once = meeting({ repeat: { freq: "none" } });
    expect(currentOccurrence(once, once.start + 30 * DAY)).toBe(once.start);
  });
});

describe("UNANCHORED", () => {
  it("is told apart from a real block", () => {
    expect(isUnanchored(UNANCHORED)).toBe(true);
    expect(isUnanchored({ top: 10, left: 20, right: 60, bottom: 30 })).toBe(false);
  });
});

describe("eventBlockStyle", () => {
  it("fills a busy meeting with its colour", () => {
    expect(eventBlockStyle(meeting(), "#eee").background).toBe("#2aabee");
  });

  it("gives a free meeting's text the window's colour, not Standard's variable", () => {
    expect(eventBlockStyle(meeting({ showAs: "free" }), "#eee").color).toBe("#eee");
  });
});

describe("reminderLabel", () => {
  it("words each offset from the catalogue", () => {
    const t = i18n.getFixedT(null, "chat");
    expect(reminderLabel(t, null)).toBe(i18n.t("chat:calendar.reminders.none"));
    expect(reminderLabel(t, 0)).toBe(i18n.t("chat:calendar.reminders.atStart"));
    expect(reminderLabel(t, 120)).toBe(i18n.t("chat:calendar.reminders.hours", { count: 2 }));
    expect(reminderLabel(t, 1440)).toBe(i18n.t("chat:calendar.reminders.days", { count: 1 }));
  });
});
