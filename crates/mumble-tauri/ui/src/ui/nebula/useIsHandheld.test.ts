import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HANDHELD_ATTR, handheldOverride, useIsHandheld } from "./useIsHandheld";

/**
 * A `matchMedia` whose answer this file controls, plus the listener set so a
 * test can fire a resize the way a browser would.
 */
function stubMedia(matches: boolean) {
  const listeners = new Set<() => void>();
  Object.defineProperty(globalThis, "matchMedia", {
    configurable: true,
    value: () => ({
      matches,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    }),
  });
  return { fire: () => listeners.forEach((fn) => fn()) };
}

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute(HANDHELD_ATTR);
  Reflect.deleteProperty(globalThis, "matchMedia");
});

describe("handheldOverride", () => {
  it("reads the two words it knows and nothing else", () => {
    expect(handheldOverride()).toBeNull();
    document.documentElement.setAttribute(HANDHELD_ATTR, "on");
    expect(handheldOverride()).toBe(true);
    document.documentElement.setAttribute(HANDHELD_ATTR, "off");
    expect(handheldOverride()).toBe(false);
    // Anything else is not an answer, so the viewport still gets to give one.
    document.documentElement.setAttribute(HANDHELD_ATTR, "yes");
    expect(handheldOverride()).toBeNull();
  });
});

describe("useIsHandheld", () => {
  it("is a window by default, which is what every existing test wants", () => {
    // jsdom answers `matches: false` to everything and its user-agent is not a
    // phone, so a suite that says nothing keeps the desktop layout.
    expect(renderHook(() => useIsHandheld()).result.current).toBe(false);
  });

  it("follows the viewport when nothing has stated an answer", () => {
    stubMedia(true);
    expect(renderHook(() => useIsHandheld()).result.current).toBe(true);
  });

  it("lets the attribute outrank the viewport, in both directions", () => {
    stubMedia(false);
    document.documentElement.setAttribute(HANDHELD_ATTR, "on");
    expect(renderHook(() => useIsHandheld()).result.current).toBe(true);
    cleanup();

    stubMedia(true);
    document.documentElement.setAttribute(HANDHELD_ATTR, "off");
    expect(renderHook(() => useIsHandheld()).result.current).toBe(false);
  });

  it("re-renders when the attribute is swapped under it", async () => {
    stubMedia(false);
    const { result } = renderHook(() => useIsHandheld());
    expect(result.current).toBe(false);

    // The preview page's own lever. A `MutationObserver` delivers on a
    // microtask, so the assertion has to let one run.
    await act(async () => {
      document.documentElement.setAttribute(HANDHELD_ATTR, "on");
      await Promise.resolve();
    });
    expect(result.current).toBe(true);
  });

  it("re-renders when the window is resized across the query", () => {
    const media = stubMedia(false);
    const { result, rerender } = renderHook(() => useIsHandheld());
    expect(result.current).toBe(false);

    // The store now answers differently; firing the listener is what tells
    // React to ask it again.
    stubMedia(true);
    act(() => media.fire());
    rerender();
    expect(result.current).toBe(true);
  });

  it("takes the platform's word for a device too wide for the query", () => {
    stubMedia(false);
    const agent = vi.spyOn(navigator, "userAgent", "get");
    agent.mockReturnValue("Mozilla/5.0 (Linux; Android 14; Pixel 9) AppleWebKit/537.36");
    try {
      expect(renderHook(() => useIsHandheld()).result.current).toBe(true);
    } finally {
      agent.mockRestore();
    }
  });
});
