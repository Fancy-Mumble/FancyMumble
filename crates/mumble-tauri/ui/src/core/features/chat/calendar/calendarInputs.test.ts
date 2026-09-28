import { describe, expect, it } from "vitest";
import { formatDateText, formatTimeText, parseDateText, parseTimeText } from "./calendarInputs";

describe("dates", () => {
  it("shows and reads each format", () => {
    expect(formatDateText("2026-09-04", "dmy")).toBe("04/09/2026");
    expect(formatDateText("2026-09-04", "mdy")).toBe("09/04/2026");
    expect(formatDateText("2026-09-04", "auto")).toBe("2026-09-04");
    expect(parseDateText("04/09/2026", "dmy")).toBe("2026-09-04");
    expect(parseDateText("09/04/2026", "mdy")).toBe("2026-09-04");
    expect(parseDateText("2026-9-4", "ymd")).toBe("2026-09-04");
  });

  it("refuses a day the month does not have", () => {
    expect(parseDateText("31/02/2026", "dmy")).toBeNull();
  });

  it("refuses text in another format while it is half typed", () => {
    expect(parseDateText("2026-09-04", "dmy")).toBeNull();
    expect(parseDateText("04/09", "dmy")).toBeNull();
    expect(parseDateText("", "auto")).toBeNull();
  });
});

describe("times", () => {
  it("shows a 24-hour value on a 12-hour clock", () => {
    expect(formatTimeText("00:05", "12h")).toBe("12:05 AM");
    expect(formatTimeText("13:30", "12h")).toBe("01:30 PM");
    expect(formatTimeText("13:30", "auto")).toBe("13:30");
  });

  it("reads noon and midnight the right way round", () => {
    expect(parseTimeText("12:00 AM", "12h")).toBe("00:00");
    expect(parseTimeText("12:30 pm", "12h")).toBe("12:30");
    expect(parseTimeText("1:05 PM", "12h")).toBe("13:05");
  });

  it("refuses a time that is not one", () => {
    expect(parseTimeText("24:00", "24h")).toBeNull();
    expect(parseTimeText("9:5", "24h")).toBeNull();
    expect(parseTimeText("09:30", "12h")).toBeNull();
  });
});
