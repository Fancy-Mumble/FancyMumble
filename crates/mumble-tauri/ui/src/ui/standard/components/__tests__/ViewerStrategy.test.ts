/**
 * Tests for the stream viewer strategy layer (viewerStrategy.ts): the
 * settings-backed selection between the webview (browser WebRTC) and
 * native (Rust signaling) families, and the abstract-factory contract
 * that per-session products always come from the selected family.
 *
 * Only viewerStrategy.ts is imported - the real family modules must stay
 * out so the registry (pinned on globalThis, shared per environment)
 * contains exactly the fakes registered here.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  activeStreamViewerStrategy,
  getStreamViewerStrategyPreference,
  parseStreamViewerStrategyId,
  registerStreamViewerStrategy,
  selectableStreamViewerStrategyIds,
  setStreamViewerStrategyPreference,
  STRATEGY_AUTO,
  StreamViewerStrategyId,
  type StreamViewerStrategy,
} from "../chat/stream/viewerStrategy";

const PREFERENCE_KEY = "fancy.streamViewerStrategy";

function makeFake(
  id: StreamViewerStrategyId,
  available: boolean,
): StreamViewerStrategy & { opened: number[]; closed: number[] } {
  const opened: number[] = [];
  const closed: number[] = [];
  return {
    id,
    opened,
    closed,
    isAvailable: () => available,
    createReceiveTransport: (session) => ({
      open: async () => {
        opened.push(session);
      },
      isOpen: () => opened.includes(session) && !closed.includes(session),
      close: () => {
        closed.push(session);
      },
    }),
    createStatsSampler: () => ({ sample: async () => null }),
  };
}

/** (Re)register both families; re-registration drops any latched choice. */
function register(webviewAvailable: boolean, nativeAvailable: boolean) {
  const webview = makeFake(StreamViewerStrategyId.Webview, webviewAvailable);
  const native = makeFake(StreamViewerStrategyId.Native, nativeAvailable);
  registerStreamViewerStrategy(webview);
  registerStreamViewerStrategy(native);
  return { webview, native };
}

describe("Stream viewer strategy selection", () => {
  beforeEach(() => {
    localStorage.removeItem(PREFERENCE_KEY);
    register(true, true);
  });

  it("defaults to the webview family under auto selection", () => {
    expect(getStreamViewerStrategyPreference()).toBe(STRATEGY_AUTO);
    expect(activeStreamViewerStrategy().id).toBe(StreamViewerStrategyId.Webview);
  });

  it("falls back to the native family when the webview has no WebRTC", () => {
    register(false, true);
    expect(activeStreamViewerStrategy().id).toBe(StreamViewerStrategyId.Native);
  });

  it("honours the persisted preference over auto order", () => {
    setStreamViewerStrategyPreference(StreamViewerStrategyId.Native);
    register(true, true); // drop the latch, as a page load would
    expect(activeStreamViewerStrategy().id).toBe(StreamViewerStrategyId.Native);
  });

  it("ignores a preferred family that is unavailable here", () => {
    setStreamViewerStrategyPreference(StreamViewerStrategyId.Native);
    register(true, false);
    expect(activeStreamViewerStrategy().id).toBe(StreamViewerStrategyId.Webview);
  });

  it("latches the choice for the whole page load", () => {
    expect(activeStreamViewerStrategy().id).toBe(StreamViewerStrategyId.Webview);
    // A preference change alone must not flip live consumers mid-session -
    // it applies on the next load (re-registration models that below).
    setStreamViewerStrategyPreference(StreamViewerStrategyId.Native);
    expect(activeStreamViewerStrategy().id).toBe(StreamViewerStrategyId.Webview);
    register(true, true);
    expect(activeStreamViewerStrategy().id).toBe(StreamViewerStrategyId.Native);
  });

  it("round-trips the preference and clears it on auto", () => {
    setStreamViewerStrategyPreference(StreamViewerStrategyId.Webview);
    expect(getStreamViewerStrategyPreference()).toBe(StreamViewerStrategyId.Webview);
    expect(localStorage.getItem(PREFERENCE_KEY)).toBe("webview");
    setStreamViewerStrategyPreference(STRATEGY_AUTO);
    expect(getStreamViewerStrategyPreference()).toBe(STRATEGY_AUTO);
    expect(localStorage.getItem(PREFERENCE_KEY)).toBeNull();
  });

  it("parses legacy raw flag values into enum members", () => {
    // Flags written before the setting existed (or by hand, per the module
    // doc) are plain strings; they must map onto the enum.
    localStorage.setItem(PREFERENCE_KEY, "native");
    expect(getStreamViewerStrategyPreference()).toBe(StreamViewerStrategyId.Native);
    expect(parseStreamViewerStrategyId("webview")).toBe(StreamViewerStrategyId.Webview);
    expect(parseStreamViewerStrategyId("quantum")).toBeNull();
    expect(parseStreamViewerStrategyId(null)).toBeNull();
  });

  it("treats a garbage stored value as auto", () => {
    localStorage.setItem(PREFERENCE_KEY, "quantum");
    expect(getStreamViewerStrategyPreference()).toBe(STRATEGY_AUTO);
    expect(activeStreamViewerStrategy().id).toBe(StreamViewerStrategyId.Webview);
  });

  it("lists only available families as selectable", () => {
    expect(selectableStreamViewerStrategyIds().sort()).toEqual([
      StreamViewerStrategyId.Native,
      StreamViewerStrategyId.Webview,
    ]);
    register(true, false);
    expect(selectableStreamViewerStrategyIds()).toEqual([StreamViewerStrategyId.Webview]);
  });
});

describe("Stream viewer abstract factory", () => {
  beforeEach(() => {
    localStorage.removeItem(PREFERENCE_KEY);
  });

  it("creates every per-session product from the selected family", async () => {
    const { webview, native } = register(true, true);
    const strategy = activeStreamViewerStrategy();
    const transport = strategy.createReceiveTransport(7);
    await transport.open();
    expect(webview.opened).toEqual([7]);
    expect(native.opened).toEqual([]);
    expect(transport.isOpen()).toBe(true);
    transport.close();
    expect(transport.isOpen()).toBe(false);
    expect(webview.closed).toEqual([7]);
  });

  it("switches the whole product family with the preference", async () => {
    setStreamViewerStrategyPreference(StreamViewerStrategyId.Native);
    const { webview, native } = register(true, true);
    const transport = activeStreamViewerStrategy().createReceiveTransport(9);
    await transport.open();
    expect(native.opened).toEqual([9]);
    expect(webview.opened).toEqual([]);
  });
});
