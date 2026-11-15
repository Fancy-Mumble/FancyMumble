import { describe, expect, it } from "vitest";
import { resolveUiDesign, UI_PACK_LOADERS } from "./registry";

describe("resolveUiDesign", () => {
  it("starts a profile with no stored choice in Nebula", () => {
    expect(resolveUiDesign("", undefined)).toBe("nebula");
    expect(resolveUiDesign("?ui=unknown", "unknown")).toBe("nebula");
  });

  it("still honours a profile that chose Standard", () => {
    // The new default is for new users; nobody who picked a pack is moved.
    expect(resolveUiDesign("", "standard")).toBe("standard");
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
