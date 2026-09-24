import { describe, expect, it } from "vitest";
import { isDeviceLink } from "./deviceLink";

describe("isDeviceLink", () => {
  it("recognises a device link and nothing else on the fancy scheme", () => {
    expect(isDeviceLink("fancy://link/ABCD-EFGH?server=chat.example.org%3A64738&user=ada")).toBe(true);
    expect(isDeviceLink("  fancy://link/ABCD  ")).toBe(true);
    expect(isDeviceLink("fancy://link/")).toBe(false);
    expect(isDeviceLink("fancy://invite/abc?server=h:1")).toBe(false);
    expect(isDeviceLink("https://link/abc")).toBe(false);
    expect(isDeviceLink("not a link")).toBe(false);
  });
});
