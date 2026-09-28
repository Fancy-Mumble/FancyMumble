import { describe, expect, it } from "vitest";
import type { CalendarEvent, EventOccurrence } from "./types";
import { addDays, MS_PER_HOUR, MS_PER_MINUTE, startOfDay } from "./calendarDates";
import { applyDrag, dragPreview, layoutDay, shiftToDay, snapMinutes, type DragOrigin } from "./timeGrid";

const DAY = startOfDay(new Date(2026, 8, 14).getTime());
const at = (hour: number, minute = 0) => DAY + hour * MS_PER_HOUR + minute * MS_PER_MINUTE;

function occ(key: string, start: number, end: number): EventOccurrence {
  return { key, start, end, event: { id: key } as CalendarEvent };
}

function origin(mode: DragOrigin["mode"]): DragOrigin {
  return { key: "k", eventId: "e", mode, startX: 0, startY: 0, origStart: at(10), origEnd: at(11) };
}

// 48px an hour, the grid both packs draw.
const GEOMETRY = { pxPerMinute: 48 / 60, columnWidth: 100 };

describe("snapMinutes", () => {
  it("lands on quarter hours", () => {
    expect(snapMinutes(7)).toBe(0);
    expect(snapMinutes(8)).toBe(15);
    expect(snapMinutes(-22)).toBe(-15);
  });
});

describe("layoutDay", () => {
  it("gives a lone meeting the whole column", () => {
    expect(layoutDay([occ("a", at(9), at(10))]).get("a")).toEqual({ lane: 0, lanes: 1 });
  });

  it("puts overlapping meetings side by side", () => {
    const layout = layoutDay([occ("a", at(9), at(11)), occ("b", at(10), at(12))]);
    expect(layout.get("a")).toEqual({ lane: 0, lanes: 2 });
    expect(layout.get("b")).toEqual({ lane: 1, lanes: 2 });
  });

  it("reuses a lane once its meeting has ended", () => {
    const layout = layoutDay([occ("a", at(9), at(10)), occ("b", at(10), at(11))]);
    expect(layout.get("b")).toEqual({ lane: 0, lanes: 1 });
  });
});

describe("dragPreview", () => {
  it("moves by whole days sideways and snapped minutes down", () => {
    // 1.6 columns right, 20px (25 min) down -> two days, 30 minutes.
    const preview = dragPreview(origin("move"), 160, 20, GEOMETRY);
    expect(preview.start).toBe(addDays(at(10), 2) + 30 * MS_PER_MINUTE);
    expect(preview.end).toBe(addDays(at(11), 2) + 30 * MS_PER_MINUTE);
    expect(preview.dx).toBe(200);
    expect(preview.dy).toBe(24);
  });

  it("keeps a move on its day while the columns are unmeasured", () => {
    const preview = dragPreview(origin("move"), 500, 0, { ...GEOMETRY, columnWidth: 0 });
    expect(preview.start).toBe(at(10));
  });

  it("never resizes a meeting below a quarter hour", () => {
    expect(dragPreview(origin("resize-start"), 0, 400, GEOMETRY).start).toBe(at(10, 45));
    expect(dragPreview(origin("resize-end"), 0, -400, GEOMETRY).end).toBe(at(10, 15));
  });
});

describe("applyDrag", () => {
  it("moves the series by what the occurrence moved", () => {
    const series = { start: at(10) - 7 * 86_400_000, end: at(11) - 7 * 86_400_000 };
    const next = applyDrag(series, origin("move"), { start: at(12), end: at(13) });
    expect(next.start - series.start).toBe(2 * MS_PER_HOUR);
    expect(next.end - series.end).toBe(2 * MS_PER_HOUR);
  });
});

describe("shiftToDay", () => {
  it("moves by the days between the occurrence and the drop", () => {
    const next = shiftToDay({ start: at(10), end: at(11) }, at(10), addDays(DAY, 3));
    expect(next).toEqual({ start: addDays(at(10), 3), end: addDays(at(11), 3) });
  });

  it("does nothing for a drop on the same day", () => {
    expect(shiftToDay({ start: at(10), end: at(11) }, at(10), DAY)).toBeNull();
  });
});
