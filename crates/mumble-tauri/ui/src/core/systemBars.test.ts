import { describe, expect, it } from "vitest";
import { isLightColor } from "./systemBars";

describe("isLightColor", () => {
  it("calls Standard's light background light and its dark one dark", () => {
    expect(isLightColor("rgb(245, 245, 249)")).toBe(true);
    expect(isLightColor("rgb(14, 14, 22)")).toBe(false);
  });

  it("weighs green over blue, as the eye does", () => {
    expect(isLightColor("rgb(0, 200, 0)")).toBe(true);
    expect(isLightColor("rgb(0, 0, 255)")).toBe(false);
  });

  it("has no answer for a transparent or unparseable colour", () => {
    expect(isLightColor("rgba(0, 0, 0, 0)")).toBeNull();
    expect(isLightColor("transparent")).toBeNull();
  });
});
