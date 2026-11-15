import { describe, it, expect } from "vitest";
import { colorModeForTheme } from "./index";

describe("colorModeForTheme", () => {
  it("wears Dark and Light as named, whatever was chosen before", () => {
    // Left on "system", a light phone showed "Dark" in light.
    expect(colorModeForTheme("dark", "system")).toBe("dark");
    expect(colorModeForTheme("light", "dark")).toBe("light");
  });

  it("leaves a theme drawn in both schemes on the mode already chosen", () => {
    expect(colorModeForTheme("rose", "system")).toBe("system");
    expect(colorModeForTheme("nimbus", "dark")).toBe("dark");
  });
});
