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
  initialWindow,
  isAtTail,
  grownUp,
  grownDown,
  MAX_MOUNTED,
  windowAfterAppend,
  windowAfterPrepend,
  windowAtTail,
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

describe("two-sided windowing", () => {
  it("opens at the tail", () => {
    const window = initialWindow(1000, 0);
    expect(window.end).toBe(1000);
    expect(window.start).toBe(1000 - BASE_WINDOW);
    expect(isAtTail(window, 1000)).toBe(true);
  });

  it("covers the unread run when entering a channel with a backlog", () => {
    const window = initialWindow(1000, 250);
    expect(window.end - window.start).toBeGreaterThanOrEqual(250);
  });

  it("releases the trailing edge once the window is full", () => {
    // The whole difference from the tail anchor. Reading backwards used to
    // keep every row between the reader and the present mounted.
    let window = initialWindow(1000, 0);
    for (let step = 0; step < 20; step += 1) window = grownUp(window, 1000);

    expect(window.end - window.start).toBeLessThanOrEqual(MAX_MOUNTED);
    expect(window.start).toBe(0);
    expect(isAtTail(window, 1000)).toBe(false);
  });

  it("releases the leading edge when growing back down", () => {
    let window = { start: 0, end: MAX_MOUNTED };
    window = grownDown(window, 1000);

    expect(window.end - window.start).toBeLessThanOrEqual(MAX_MOUNTED);
    expect(window.start).toBeGreaterThan(0);
  });

  it("never mounts more than the ceiling however far it is driven", () => {
    let window = initialWindow(5000, 0);
    for (let step = 0; step < 100; step += 1) window = grownUp(window, 5000);
    for (let step = 0; step < 100; step += 1) window = grownDown(window, 5000);

    expect(window.end - window.start).toBeLessThanOrEqual(MAX_MOUNTED);
  });

  it("follows an arrival down only when it was already at the tail", () => {
    const atTail = { start: 900, end: 1000 };
    expect(windowAfterAppend(atTail, 1001, true).end).toBe(1001);

    // Scrolled up: moving would show the reader something they did not ask
    // for and shift what they are reading.
    const scrolledUp = { start: 100, end: 300 };
    expect(windowAfterAppend(scrolledUp, 1001, false)).toEqual(scrolledUp);
  });

  it("shifts with a page joined at the head", () => {
    // Every index moves by the size of the page, so a window that did not
    // move would appear to jump backwards by exactly that much.
    const window = { start: 10, end: 110 };
    expect(windowAfterPrepend(window, 50)).toEqual({ start: 60, end: 160 });
  });

  it("snaps back to the tail on jump-to-bottom", () => {
    const window = windowAtTail(1000);
    expect(window.end).toBe(1000);
    expect(isAtTail(window, 1000)).toBe(true);
  });

  it("handles a thread shorter than one window", () => {
    const window = initialWindow(5, 0);
    expect(window.start).toBe(0);
    expect(window.end).toBe(5);
    expect(grownUp(window, 5).start).toBe(0);
    expect(grownDown(window, 5).end).toBe(5);
  });
});
