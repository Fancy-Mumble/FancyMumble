import { describe, expect, it } from "vitest";
import { resolveUiDesign } from "./registry";

describe("resolveUiDesign", () => {
  it("keeps the legacy UI as the safe default", () => {
    expect(resolveUiDesign("", undefined)).toBe("legacy");
    expect(resolveUiDesign("?ui=unknown", "unknown")).toBe("legacy");
  });

  it("uses a persisted design when there is no valid URL override", () => {
    expect(resolveUiDesign("", "new")).toBe("new");
    expect(resolveUiDesign("?ui=unknown", "new")).toBe("new");
  });

  it("gives a valid URL override precedence", () => {
    expect(resolveUiDesign("?ui=new", "legacy")).toBe("new");
    expect(resolveUiDesign("?ui=legacy", "new")).toBe("legacy");
  });
});
