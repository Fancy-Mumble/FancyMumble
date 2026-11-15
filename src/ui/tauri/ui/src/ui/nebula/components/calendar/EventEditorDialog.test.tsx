import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@core/store";
import { TID } from "@core/testids";
import { useCalendarStore } from "@core/features/chat/calendar/calendarStore";
import { withNebulaTheme } from "../../testTheme";
import { EventEditorDialog } from "./EventEditorDialog";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => undefined) }));
vi.mock("@core/lazyBlobs", () => ({ useUserAvatar: () => null, getCachedUserAvatar: () => null }));

const prefs = vi.hoisted(() => ({ dateFormat: "auto" }));
vi.mock("@core/preferencesStorage", () => ({
  getPreferences: () =>
    Promise.resolve({ timeFormat: "24h", dateFormat: prefs.dateFormat, convertToLocalTime: true }),
}));

// Tiptap has its own tests; what matters here is that the description reaches the event.
vi.mock("../primitives", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../primitives")>()),
  RichTextField: ({ value, onChange, ariaLabel }: { value: string; onChange: (html: string) => void; ariaLabel: string }) => (
    <textarea aria-label={ariaLabel} value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}));

const DRAFT = new Date(2026, 8, 16, 9).getTime();

function show() {
  useCalendarStore.setState({ events: [], dialogOpen: true, editingEventId: null, draftStart: DRAFT });
  render(withNebulaTheme(<EventEditorDialog onDelete={vi.fn()} />));
}

describe("EventEditorDialog", () => {
  beforeEach(() => {
    prefs.dateFormat = "auto";
    useAppStore.setState({
      users: [
        { session: 1, user_id: 5, name: "Sebi", texture_size: null },
        { session: 2, user_id: 9, name: "Jonas", texture_size: null },
      ],
      ownSession: 1,
    } as never);
  });
  afterEach(cleanup);

  it("saves what was typed, with its invitee, as a meeting you organise", () => {
    show();
    fireEvent.change(screen.getByTestId(TID.calendarTitleInput), { target: { value: "Raid planning" } });
    fireEvent.change(screen.getByTestId(TID.calendarInviteeInput), { target: { value: "Jon" } });
    fireEvent.mouseDown(screen.getByRole("option", { name: /Jonas/ }));
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "<p>maps</p>" } });
    fireEvent.click(screen.getByTestId(TID.calendarSave));

    const [saved] = useCalendarStore.getState().events;
    expect(saved.title).toBe("Raid planning");
    expect(saved.organizerId).toBe(5);
    expect(saved.participants).toEqual([{ userId: 9, name: "Jonas", status: "invited" }]);
    expect(saved.description).toBe("<p>maps</p>");
    expect(saved.start).toBe(DRAFT);
    expect(saved.end - saved.start).toBe(3_600_000);
    expect(useCalendarStore.getState().dialogOpen).toBe(false);
  });

  it("reads the date in the format the user chose", async () => {
    prefs.dateFormat = "dmy";
    show();
    const date = screen.getByTestId(TID.calendarStartDate) as HTMLInputElement;
    await waitFor(() => expect(date.value).toBe("16/09/2026"));

    fireEvent.change(date, { target: { value: "20/09/2026" } });
    fireEvent.click(screen.getByTestId(TID.calendarSave));
    const saved = new Date(useCalendarStore.getState().events[0].start);
    expect([saved.getDate(), saved.getHours()]).toEqual([20, 9]);
  });

  it("offers the reminder as the native select the e2e suite sets", () => {
    show();
    const select = screen.getByTestId(TID.calendarReminderSelect) as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    fireEvent.change(select, { target: { value: "none" } });
    fireEvent.click(screen.getByTestId(TID.calendarSave));
    expect(useCalendarStore.getState().events[0].reminderMinutes).toBeNull();
  });
});
