import { afterEach, describe, expect, it } from "vitest";
import { formatBytes, formatDayLabel, formatNumber, setNumberAndDateFormat } from "./format";

describe("numbers and dates as the reader chose", () => {
  afterEach(() => setNumberAndDateFormat());

  it("writes a file's size with the chosen decimal mark", () => {
    setNumberAndDateFormat("comma-period");
    expect(formatBytes(1536)).toBe("1.5 KiB");
    setNumberAndDateFormat("period-comma");
    expect(formatBytes(1536)).toBe("1,5 KiB");
    expect(formatNumber(1234567.89, 2)).toBe("1.234.567,89");
    setNumberAndDateFormat("space-comma");
    expect(formatBytes(1536)).toBe("1,5 KiB");
    expect(formatNumber(1234, 0).replace(/\s/g, " ")).toBe("1 234");
  });

  it("writes a day before yesterday in the chosen date format", () => {
    const day = new Date(2026, 4, 7);
    setNumberAndDateFormat(undefined, "ymd");
    expect(formatDayLabel(day)).toMatch(/2026-05-07$/);
    setNumberAndDateFormat(undefined, "dmy");
    expect(formatDayLabel(day)).toMatch(/07\/05\/2026$/);
    setNumberAndDateFormat(undefined, "mdy");
    expect(formatDayLabel(day)).toMatch(/05\/07\/2026$/);
    setNumberAndDateFormat();
    expect(formatDayLabel(day)).toBe(
      day.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }),
    );
  });
});
