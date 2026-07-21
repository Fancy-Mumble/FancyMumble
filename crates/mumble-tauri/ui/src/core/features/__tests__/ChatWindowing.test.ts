/**
 * Tests for the tail-anchored chat render window sizing policy
 * (chatWindowing.ts).  The window keeps DOM bounded: only the last
 * `tailCount` messages mount, growing while the user reads history and
 * snapping back at the bottom.
 */

import { describe, it, expect } from "vitest";
import {
  BASE_WINDOW,
  WINDOW_GROW_CHUNK,
  initialTailCount,
  tailCountAfterAppend,
  grownTailCount,
  tailCountToInclude,
} from "../chat/chatWindowing";

describe("chat render window sizing", () => {
  // -- Entering a thread --

  it("starts at the base size for a read thread", () => {
    expect(initialTailCount(0)).toBe(BASE_WINDOW);
  });

  it("covers all unreads plus context above the divider", () => {
    const tail = initialTailCount(250);
    expect(tail).toBeGreaterThan(250); // divider itself must be mounted
    expect(tail - 250).toBeLessThanOrEqual(BASE_WINDOW); // just context, not everything
  });

  it("small unread counts keep the base size", () => {
    expect(initialTailCount(5)).toBe(BASE_WINDOW);
  });

  // -- Appending new messages --

  it("snaps back to base size when reading at the bottom", () => {
    expect(tailCountAfterAppend(400, 3, true)).toBe(BASE_WINDOW);
  });

  it("grows with appended messages while scrolled up", () => {
    // The window must keep starting at the same message, otherwise the
    // content above the viewport shifts on every arrival.
    expect(tailCountAfterAppend(200, 3, false)).toBe(203);
  });

  // -- Near-top growth --

  it("grows by one chunk", () => {
    expect(grownTailCount(BASE_WINDOW, 500)).toBe(BASE_WINDOW + WINDOW_GROW_CHUNK);
  });

  it("caps growth at the list size", () => {
    expect(grownTailCount(450, 500)).toBe(500);
    expect(grownTailCount(500, 500)).toBe(500);
  });

  // -- Jump to a specific message --

  it("includes a jump target with context above it", () => {
    const total = 500;
    const targetIdx = 100;
    const tail = tailCountToInclude(BASE_WINDOW, targetIdx, total);
    // Window start = total - tail must be at or before the target.
    expect(total - tail).toBeLessThanOrEqual(targetIdx);
  });

  it("never shrinks the window for a jump target", () => {
    expect(tailCountToInclude(400, 450, 500)).toBe(400);
  });

  it("is capped at the list size", () => {
    expect(tailCountToInclude(BASE_WINDOW, 0, 500)).toBe(500);
  });

  it("already-mounted targets keep the current window", () => {
    // Message at index 450 of 500 is inside the base window (start 400).
    expect(tailCountToInclude(BASE_WINDOW, 450, 500)).toBe(BASE_WINDOW);
  });
});
