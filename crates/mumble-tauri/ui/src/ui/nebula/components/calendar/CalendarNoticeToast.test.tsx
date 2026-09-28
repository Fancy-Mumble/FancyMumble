import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@core/store";
import { useCalendarStore } from "@core/features/chat/calendar/calendarStore";
import { EVT_MEETING_ROOM } from "@core/features/chat/calendar/meetings";
import { EVT_CALENDAR_REMINDER, type CalendarEvent } from "@core/features/chat/calendar/types";
import { withNebulaTheme } from "../../testTheme";
import { CalendarNoticeToast } from "./CalendarNoticeToast";
import { useCalendarNotices } from "./useCalendarNotices";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock("@core/preferencesStorage", () => ({
  getPreferences: () => Promise.resolve({ timeFormat: "24h", dateFormat: "auto", convertToLocalTime: true }),
}));

const meetings = vi.hoisted(() => ({ requestJoinMeeting: vi.fn() }));
vi.mock("@core/features/chat/calendar/meetings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@core/features/chat/calendar/meetings")>()),
  ...meetings,
}));

const START = Date.now() + 10 * 60_000;
const standup: CalendarEvent = {
  id: "evt-1",
  organizerId: 1,
  organizerName: "Sebi",
  title: "Standup",
  location: "Room 3",
  description: "",
  start: START,
  end: START + 900_000,
  allDay: false,
  repeat: { freq: "none" },
  color: "#2aabee",
  participants: [],
  reminderMinutes: 15,
  createdAt: 0,
  updatedAt: 0,
};

function Harness({ onOpen }: Readonly<{ onOpen: (eventId: string, occStart: number) => void }>) {
  const { notice, dismiss } = useCalendarNotices();
  return <CalendarNoticeToast notice={notice} onDismiss={dismiss} onOpen={onOpen} />;
}

const fire = (type: string, detail: unknown) =>
  act(() => {
    globalThis.dispatchEvent(new CustomEvent(type, { detail }));
  });

describe("calendar notices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCalendarStore.setState({ events: [standup] });
    useAppStore.setState({ activeServerId: "srv" } as never);
  });
  afterEach(cleanup);

  it("shows the meeting a reminder is for, and opens it", () => {
    const onOpen = vi.fn();
    render(withNebulaTheme(<Harness onOpen={onOpen} />));
    fire(EVT_CALENDAR_REMINDER, { eventId: "evt-1", occStart: START });

    expect(screen.getByText("Upcoming meeting")).toBeTruthy();
    expect(screen.getByText("Standup")).toBeTruthy();
    expect(screen.getByText(/Room 3/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(onOpen).toHaveBeenCalledWith("evt-1", START);
    expect(screen.queryByText("Standup")).toBeNull();
  });

  it("joins from a reminder without announcing the room it leads to", () => {
    render(withNebulaTheme(<Harness onOpen={vi.fn()} />));
    fire(EVT_CALENDAR_REMINDER, { eventId: "evt-1", occStart: START });
    fireEvent.click(screen.getByRole("button", { name: "Join meeting" }));
    expect(meetings.requestJoinMeeting).toHaveBeenCalledWith("evt-1");

    fire(EVT_MEETING_ROOM, { eventId: "evt-1", channelId: 40 });
    expect(screen.queryByText("You are in the meeting room")).toBeNull();
  });

  it("says which meeting a room reached from a link belongs to", () => {
    render(withNebulaTheme(<Harness onOpen={vi.fn()} />));
    fire(EVT_MEETING_ROOM, { eventId: "evt-1", channelId: 41 });
    expect(screen.getByText("You are in the meeting room")).toBeTruthy();
    expect(screen.getByText("Standup")).toBeTruthy();
  });

  it("says nothing about a room whose meeting is not on this calendar", () => {
    render(withNebulaTheme(<Harness onOpen={vi.fn()} />));
    fire(EVT_MEETING_ROOM, { eventId: "someone-elses", channelId: 42 });
    expect(screen.queryByText("You are in the meeting room")).toBeNull();
  });

  it("remembers which meeting a room is, per server", () => {
    const { result } = renderHook(() => useCalendarNotices());
    fire(EVT_MEETING_ROOM, { eventId: "evt-1", channelId: 43 });
    expect(result.current.meetingInRoom("srv", 43)).toBe("evt-1");
    expect(result.current.meetingInRoom("other", 43)).toBeUndefined();
    expect(result.current.meetingInRoom("srv", null)).toBeUndefined();
  });
});
