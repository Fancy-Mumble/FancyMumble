import { describe, expect, it } from "vitest";
import { previewDate, previewNumber, previewTime } from "./formatPreview";

// Fixed instant so the assertions below are not clock-dependent.
const SAMPLE = new Date(Date.UTC(2026, 2, 4, 15, 7, 0));

describe("localization format previews", () => {
  it("honours the chosen clock convention regardless of UI locale", () => {
    expect(previewTime("24h", "en-US", SAMPLE)).toMatch(/^\d{2}:\d{2}$/);
    expect(previewTime("12h", "de-DE", SAMPLE)).toMatch(/(AM|PM)/i);
  });

  it("pins date order to the chosen format, not the locale", () => {
    // 4 March: day-first and month-first must disagree, or the preview is a lie.
    expect(previewDate("dmy", "en-US", SAMPLE)).toBe("04/03/2026");
    expect(previewDate("mdy", "de-DE", SAMPLE)).toBe("3/4/2026");
    expect(previewDate("ymd", "fr-FR", SAMPLE)).toBe("2026-03-04");
  });

  it("pins digit separators to the chosen format", () => {
    expect(previewNumber("comma-period", "de-DE")).toBe("1,234,567.89");
    expect(previewNumber("period-comma", "en-US")).toBe("1.234.567,89");
    // fr-FR groups with a narrow no-break space, so compare the decimal mark.
    expect(previewNumber("space-comma", "en-US")).toContain(",89");
  });

  it("follows the active locale when set to auto", () => {
    expect(previewNumber("auto", "de-DE")).toBe("1.234.567,89");
    expect(previewNumber("auto", "en-US")).toBe("1,234,567.89");
  });
});
