import { describe, expect, it } from "vitest";
import { resolveUiDesign } from "./registry";

describe("resolveUiDesign", () => {
  it("keeps the Standard UI as the safe default", () => {
    expect(resolveUiDesign("", undefined)).toBe("standard");
    expect(resolveUiDesign("?ui=unknown", "unknown")).toBe("standard");
  });

  it("uses a persisted design when there is no valid URL override", () => {
    expect(resolveUiDesign("", "aurora")).toBe("aurora");
    expect(resolveUiDesign("?ui=unknown", "aurora")).toBe("aurora");
  });

  it("gives a valid URL override precedence", () => {
    expect(resolveUiDesign("?ui=aurora", "standard")).toBe("aurora");
    expect(resolveUiDesign("?ui=standard", "aurora")).toBe("standard");
  });
});
