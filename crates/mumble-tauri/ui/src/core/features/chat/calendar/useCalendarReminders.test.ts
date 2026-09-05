/**
 * The reminder is the one thing the calendar draws outside the app: an OS
 * notification, composed in this hook rather than by a component. That is why
 * its strings are asked of the i18next instance directly, and why they are
 * worth a test - a component would have been caught by the pack's own tests.
 */
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../../i18n";
import { useAppStore } from "../../../store";
import { PLUGIN_NAME_CALENDAR } from "../../../constants/pluginData";
import { shortTime } from "./calendarFormat";
import { useCalendarStore } from "./calendarStore";
import { useCalendarReminders } from "./useCalendarReminders";
import type { CalendarEvent } from "./types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

const MINUTE = 60_000;

/** An event starting in five minutes, with a ten-minute reminder - so the
 *  reminder is already five minutes overdue and fires on the first tick. */
function dueEvent(extra: Partial<CalendarEvent> = {}): CalendarEvent {
  const start = Date.now() + 5 * MINUTE;
  return {
    id: "evt-1",
    organizerId: 1,
    organizerName: "Sebi",
    title: "Standup",
    location: "",
    description: "",
    start,
    end: start + 30 * MINUTE,
    allDay: false,
    repeat: { freq: "none" },
    color: "#2aabee",
    participants: [],
    reminderMinutes: 10,
    createdAt: 0,
    updatedAt: 0,
    ...extra,
  } as CalendarEvent;
}

/** The reminder's title and body, caught off the DOM event the notification
 *  mirrors itself onto. */
function fireAndCapture(event: CalendarEvent): { title: string; body: string } | null {
  let seen: { title: string; body: string } | null = null;
  const listen = (e: Event) => {
    seen = (e as CustomEvent<{ title: string; body: string }>).detail;
  };
  globalThis.addEventListener("fancy:desktop-notification", listen);
  useCalendarStore.setState({ events: [event] });
  const { unmount } = renderHook(() => useCalendarReminders());
  unmount();
  globalThis.removeEventListener("fancy:desktop-notification", listen);
  return seen;
}

beforeEach(() => {
  // Only a server running the calendar plugin fires reminders at all.
  useAppStore.setState({ pluginInfos: new Map([[PLUGIN_NAME_CALENDAR, {}]]) } as never);
  useCalendarStore.setState({ events: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("calendar reminder notification", () => {
  it("takes its body from the catalogue, not from an English literal", () => {
    const event = dueEvent();
    const seen = fireAndCapture(event);
    expect(seen).not.toBeNull();
    expect(seen?.title).toBe("Standup");
    expect(seen?.body).toBe(
      i18n.t("chat:calendar.reminderNotification.body", { time: shortTime(event.start) }),
    );
  });

  it("names the place when the meeting has one", () => {
    const seen = fireAndCapture(dueEvent({ location: "Room 3" }));
    expect(seen?.body).toContain("Room 3");
  });

  it("leaves the separator off when it does not", () => {
    const seen = fireAndCapture(dueEvent());
    expect(seen?.body).not.toContain("·");
  });

  it("falls back to a translated word when the event is untitled", () => {
    const seen = fireAndCapture(dueEvent({ title: "" }));
    expect(seen?.title).toBe(i18n.t("chat:calendar.reminderNotification.untitledEvent"));
    expect(seen?.title).not.toBe("");
  });

  it("follows the language rather than staying English", async () => {
    i18n.addResourceBundle(
      "de",
      "chat",
      { calendar: { reminderNotification: { untitledEvent: "Besprechung", body: "Beginnt um {{time}}" } } },
      true,
      true,
    );
    await i18n.changeLanguage("de");
    try {
      const seen = fireAndCapture(dueEvent({ title: "" }));
      expect(seen?.title).toBe("Besprechung");
      expect(seen?.body).toContain("Beginnt um");
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});
