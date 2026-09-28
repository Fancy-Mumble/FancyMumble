import { describe, expect, it } from "vitest";
import { resolveMode } from "./useNebulaAppearance";

describe("resolveMode", () => {
  // Custom properties come back as authored, not resolved to `rgb()`, and every
  // bundled theme writes its background as a hex literal.
  it("reads the hex notation the theme files actually use", () => {
    expect(resolveMode("#f5f5f9")).toBe("light");
    expect(resolveMode("#0e0e16")).toBe("dark");
    expect(resolveMode("#FDFBF6")).toBe("light");
    expect(resolveMode("#fff")).toBe("light");
    expect(resolveMode("#000")).toBe("dark");
  });

  it("also reads functional notation", () => {
    expect(resolveMode("rgb(253, 251, 246)")).toBe("light");
    expect(resolveMode("rgba(20, 29, 51, 0.9)")).toBe("dark");
    expect(resolveMode("rgb(100% 100% 100%)")).toBe("light");
  });

  it("falls back to dark when the theme has not applied yet", () => {
    expect(resolveMode("")).toBe("dark");
    expect(resolveMode("var(--missing)")).toBe("dark");
  });
});
