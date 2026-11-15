import { describe, expect, it } from "vitest";
import { nebulaChannelViewer } from "./useChannelViewer";

describe("nebulaChannelViewer", () => {
  it("draws the two layouts Nebula has", () => {
    expect(nebulaChannelViewer("flat")).toBe("flat");
    expect(nebulaChannelViewer("modern")).toBe("modern");
  });

  it("reads Standard's third value as the nearer of the two", () => {
    // "Classic" is Standard's occupant-less tree. Nebula has no such layout,
    // and a record written from Standard must not leave the list blank.
    expect(nebulaChannelViewer("classic")).toBe("flat");
  });

  it("falls back to flat when nothing has been chosen", () => {
    expect(nebulaChannelViewer(undefined)).toBe("flat");
  });
});
