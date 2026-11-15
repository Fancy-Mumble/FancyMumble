import { describe, expect, it } from "vitest";
import { draftParticipants, draftRange, nextHour } from "./eventDraft";

const times = { allDay: false, startDate: "2026-09-14", startTime: "10:00", endDate: "2026-09-14", endTime: "11:30" };

describe("draftRange", () => {
  it("reads the typed start and end", () => {
    const { start, end } = draftRange(times);
    expect(new Date(start).getHours()).toBe(10);
    expect(end - start).toBe(90 * 60_000);
  });

  it("runs an all-day meeting to the midnight after its last day", () => {
    const { start, end } = draftRange({ ...times, allDay: true, endDate: "2026-09-15" });
    expect(new Date(start).getHours()).toBe(0);
    expect(end - start).toBe(2 * 86_400_000);
  });

  it("reads an end before the start as an hour-long meeting", () => {
    const { start, end } = draftRange({ ...times, endTime: "09:00" });
    expect(end - start).toBe(3_600_000);
  });
});

describe("draftParticipants", () => {
  it("keeps an existing invitee's response and names a new one from the candidates", () => {
    const result = draftParticipants(
      [1, 2, 3],
      [{ userId: 1, name: "Sebi", status: "accepted" }],
      [{ user_id: 2, name: "Jonas" }],
    );
    expect(result).toEqual([
      { userId: 1, name: "Sebi", status: "accepted" },
      { userId: 2, name: "Jonas", status: "invited" },
      { userId: 3, name: "#3", status: "invited" },
    ]);
  });
});

describe("nextHour", () => {
  it("rounds up to the next whole hour", () => {
    const d = new Date(nextHour(new Date(2026, 8, 14, 10, 20).getTime()));
    expect([d.getHours(), d.getMinutes()]).toEqual([11, 0]);
  });
});
