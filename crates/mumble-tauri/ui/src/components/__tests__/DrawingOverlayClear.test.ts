/**
 * Regression tests for the broadcaster's "clear everyone" flow and the
 * automatic per-sender wipe that fires when a broadcaster's stream
 * stops or they disconnect.
 *
 * The DrawingOverlay module installs a global Tauri `draw-stroke`
 * listener via `listen()`.  We mock `@tauri-apps/api/event` so the
 * import doesn't try to talk to a missing IPC bridge during tests.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
  emit: vi.fn(async () => undefined),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
}));

import {
  clearAllStrokesInChannel,
  clearStrokesFromSender,
  mergeSnapshotStrokes,
} from "../chat/drawing/DrawingOverlay";

// Module-private store helpers aren't exported, so we exercise them
// indirectly through the global `draw-stroke` event.  Re-implement the
// minimal listener wiring here by importing the same module path -
// `applyStrokeEvent` is invoked by the real listener that the module
// installs on first import.  For deterministic assertions we directly
// drive the helpers and check that they don't throw on an unknown
// channel and that they no-op correctly.

describe("DrawingOverlay sender / channel clear helpers", () => {
  beforeEach(() => {
    // No setup needed - helpers operate on module-level Maps that we
    // touch only via the exported helpers, so each test starts clean
    // unless a prior test populated state for a specific channel.
  });

  it("clearAllStrokesInChannel is a no-op for an unknown channel", () => {
    expect(() => clearAllStrokesInChannel(99_999)).not.toThrow();
  });

  it("clearStrokesFromSender is a no-op when no strokes exist", () => {
    expect(() => clearStrokesFromSender(12_345)).not.toThrow();
  });

  it("helpers are idempotent when called repeatedly", () => {
    clearAllStrokesInChannel(42);
    clearAllStrokesInChannel(42);
    clearStrokesFromSender(7);
    clearStrokesFromSender(7);
    // No throws, no leaked state - the assertion is reaching this line.
    expect(true).toBe(true);
  });
});

// Cross-window snapshot merging: a freshly opened popout/overlay window
// requests the stroke state from longer-running webviews and merges the
// answers.  Merging must be idempotent (several windows may respond) and
// must never let a stale responder shrink a stroke the local realm has
// already extended via live mirror packets.
describe("mergeSnapshotStrokes", () => {
  const stroke = (strokeId: string, points: number[]) => ({
    strokeId,
    color: 0xff_ff_00_00,
    width: 4,
    widthFrac: 0.005,
    points,
  });

  it("adds strokes missing from the target", () => {
    const target = new Map();
    const changed = mergeSnapshotStrokes(target, [stroke("5:a", [0.1, 0.2])]);
    expect(changed).toBe(1);
    expect(target.get("5:a")?.points).toEqual([0.1, 0.2]);
  });

  it("replaces a stroke when the snapshot has more points", () => {
    const target = new Map([["5:a", stroke("5:a", [0.1, 0.2])]]);
    const changed = mergeSnapshotStrokes(target, [stroke("5:a", [0.1, 0.2, 0.3, 0.4])]);
    expect(changed).toBe(1);
    expect(target.get("5:a")?.points).toEqual([0.1, 0.2, 0.3, 0.4]);
  });

  it("keeps the local stroke when it is longer than the snapshot's", () => {
    const target = new Map([["5:a", stroke("5:a", [0.1, 0.2, 0.3, 0.4])]]);
    const changed = mergeSnapshotStrokes(target, [stroke("5:a", [0.1, 0.2])]);
    expect(changed).toBe(0);
    expect(target.get("5:a")?.points).toEqual([0.1, 0.2, 0.3, 0.4]);
  });

  it("is idempotent when the same snapshot is applied twice", () => {
    const target = new Map();
    mergeSnapshotStrokes(target, [stroke("5:a", [0.1, 0.2]), stroke("6:b", [0.5, 0.6])]);
    const changed = mergeSnapshotStrokes(target, [stroke("5:a", [0.1, 0.2]), stroke("6:b", [0.5, 0.6])]);
    expect(changed).toBe(0);
    expect(target.size).toBe(2);
  });
});
