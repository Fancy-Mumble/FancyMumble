import { describe, expect, it } from "vitest";

import { isSpentWatchMarker, readWatchMarker } from "./watchMarker";

const MARKER = "<!-- FANCY_WATCH:9a1f-22 -->";
const live = (id: string) => id === "9a1f-22";
const ended = () => false;

describe("watch markers", () => {
  it("reads the session out of a marker", () => {
    expect(readWatchMarker(MARKER)).toBe("9a1f-22");
    expect(readWatchMarker("just words")).toBeNull();
  });

  it("keeps a marker whose session is still running", () => {
    expect(isSpentWatchMarker(MARKER, live)).toBe(false);
  });

  it("spends a marker once its session is over", () => {
    // Otherwise the row survives as an empty bubble with a timestamp on it -
    // and a channel that has run several sessions collects a column of them.
    expect(isSpentWatchMarker(MARKER, ended)).toBe(true);
  });

  it("never spends a message that also carries words", () => {
    // The marker is sent on its own. Anything else in the body is someone's
    // message, and hiding it would lose what they said.
    expect(isSpentWatchMarker(`film night ${MARKER}`, ended)).toBe(false);
  });

  it("leaves ordinary messages alone", () => {
    expect(isSpentWatchMarker("just words", ended)).toBe(false);
    expect(isSpentWatchMarker("", ended)).toBe(false);
  });
});
