import { describe, expect, it } from "vitest";
import { resolveUiDesign, UI_PACK_LOADERS } from "./registry";

describe("resolveUiDesign", () => {
  it("keeps the Standard UI as the safe default", () => {
    expect(resolveUiDesign("", undefined)).toBe("standard");
    expect(resolveUiDesign("?ui=unknown", "unknown")).toBe("standard");
  });

  it("uses a persisted design when there is no valid URL override", () => {
    expect(resolveUiDesign("", "aurora")).toBe("aurora");
    expect(resolveUiDesign("", "nebula")).toBe("nebula");
    expect(resolveUiDesign("?ui=unknown", "aurora")).toBe("aurora");
  });

  it("gives a valid URL override precedence", () => {
    expect(resolveUiDesign("?ui=aurora", "standard")).toBe("aurora");
    expect(resolveUiDesign("?ui=nebula", "aurora")).toBe("nebula");
    expect(resolveUiDesign("?ui=standard", "nebula")).toBe("standard");
  });

  it("knows every pack the registry can load", () => {
    for (const design of Object.keys(UI_PACK_LOADERS))
      expect(resolveUiDesign(`?ui=${design}`, "standard")).toBe(design);
  });
});
