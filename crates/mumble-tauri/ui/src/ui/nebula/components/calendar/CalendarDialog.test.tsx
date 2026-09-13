import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@core/store";
import { TID } from "@core/testids";
import { useCalendarStore } from "@core/features/chat/calendar/calendarStore";
import { startOfDay } from "@core/features/chat/calendar/calendarDates";
import { EVT_MEETING_INVITE_LINK } from "@core/features/chat/calendar/meetings";
import type { CalendarEvent } from "@core/features/chat/calendar/types";
import { withNebulaTheme } from "../../testTheme";
import { CalendarDialog } from "./CalendarDialog";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => undefined) }));
vi.mock("@core/lazyBlobs", () => ({ useUserAvatar: () => null, getCachedUserAvatar: () => null }));
vi.mock("@core/preferencesStorage", () => ({
  getPreferences: () => Promise.resolve({ timeFormat: "24h", dateFormat: "auto", convertToLocalTime: true }),
}));

const meetings = vi.hoisted(() => ({ requestJoinMeeting: vi.fn(), requestMeetingInviteLink: vi.fn() }));
vi.mock("@core/features/chat/calendar/meetings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@core/features/chat/calendar/meetings")>()),
  ...meetings,
}));

const ME = 5;
const START = new Date(2026, 8, 16, 14).getTime();

function meeting(extra: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "evt-1",
    organizerId: ME,
    organizerName: "Sebi",
    title: "Raid planning",
    location: "War room",
    description: "<p>Bring the <strong>maps</strong></p>",
    start: START,
    end: START + 3_600_000,
    allDay: false,
    repeat: { freq: "none" },
    color: "#7c5cff",
    participants: [{ userId: 9, name: "Jonas", status: "accepted" }],
    reminderMinutes: 15,
    createdAt: 0,
    updatedAt: 0,
    ...extra,
  };
}

function show(events: CalendarEvent[] = [meeting()]) {
  const onClose = vi.fn();
  useCalendarStore.setState({
    events,
    view: "month",
    anchor: startOfDay(START),
    detail: null,
    menu: null,
    dialogOpen: false,
  });
  render(withNebulaTheme(<CalendarDialog onClose={onClose} />));
  return { onClose };
}

const chip = (title: string) =>
  document.querySelector<HTMLElement>(`[data-testid="${TID.calendarEvent}"][data-event-title="${title}"]`)!;

describe("CalendarDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      users: [{ session: 1, user_id: ME, name: "Sebi", texture_size: null }],
      ownSession: 1,
    } as never);
  });
  afterEach(cleanup);

  it("draws a meeting on its day and keeps it through a change of grid", () => {
    show();
    expect(screen.getByTestId(TID.calendarPanel)).toBeTruthy();
    expect(chip("Raid planning")).toBeTruthy();

    fireEvent.click(document.querySelector(`[data-testid="${TID.calendarViewButton}"][data-view="week"]`)!);
    expect(useCalendarStore.getState().view).toBe("week");
    expect(chip("Raid planning")).toBeTruthy();
  });

  it("opens a meeting's card, and joining its room puts the calendar away", () => {
    const { onClose } = show();
    fireEvent.click(chip("Raid planning"));
    const card = screen.getByTestId(TID.calendarDetailCard);
    expect(within(card).getByText("War room")).toBeTruthy();
    expect(within(card).getByText("maps")).toBeTruthy();

    fireEvent.click(within(card).getByTestId(TID.calendarJoinMeeting));
    expect(meetings.requestJoinMeeting).toHaveBeenCalledWith("evt-1");
    expect(onClose).toHaveBeenCalled();
    expect(useCalendarStore.getState().detail).toBeNull();
  });

  it("asks before a meeting is deleted, and says who else loses it", () => {
    show();
    fireEvent.click(chip("Raid planning"));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(useCalendarStore.getState().events).toHaveLength(1);

    const dialog = screen.getByRole("dialog", { name: "" , hidden: false });
    expect(screen.getByText(/everyone you invited/)).toBeTruthy();
    fireEvent.click(within(screen.getByText(/everyone you invited/).closest("[role=dialog]") ?? dialog).getByRole("button", { name: "Delete" }));
    expect(useCalendarStore.getState().events).toHaveLength(0);
  });

  it("lets an invitee answer from the card", () => {
    show([meeting({ organizerId: 9, organizerName: "Jonas", participants: [] })]);
    fireEvent.click(chip("Raid planning"));
    const card = screen.getByTestId(TID.calendarDetailCard);
    expect(within(card).queryByTestId(TID.calendarCopyInviteLink)).toBeNull();

    fireEvent.click(within(card).getByRole("radio", { name: "Accept" }));
    expect(useCalendarStore.getState().events[0].myStatus).toBe("accepted");
  });

  it("copies the invite link once the server has sent it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    show();
    fireEvent.click(chip("Raid planning"));
    fireEvent.click(screen.getByTestId(TID.calendarCopyInviteLink));
    expect(meetings.requestMeetingInviteLink).toHaveBeenCalledWith("evt-1");

    act(() => {
      globalThis.dispatchEvent(
        new CustomEvent(EVT_MEETING_INVITE_LINK, { detail: { eventId: "evt-1", url: "fancy://meeting/evt-1?t=x" } }),
      );
    });
    await waitFor(() => expect(screen.getByText("Link copied")).toBeTruthy());
    expect(writeText).toHaveBeenCalledWith("fancy://meeting/evt-1?t=x");
  });

  it("opens a crowded day on its own from the count of what did not fit", () => {
    show(
      ["A", "B", "C", "D"].map((title, index) =>
        meeting({ id: `e${index}`, title, start: START + index * 60_000, end: START + 3_600_000 }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "+1 more" }));
    expect(useCalendarStore.getState().view).toBe("day");
    expect(useCalendarStore.getState().anchor).toBe(startOfDay(START));
  });

  it("starts a new meeting at nine from an empty part of a day", () => {
    show([]);
    fireEvent.click(screen.getByTestId(TID.calendarNewMeeting));
    expect(useCalendarStore.getState().dialogOpen).toBe(true);
    expect(useCalendarStore.getState().draftStart).toBeNull();
  });
});
