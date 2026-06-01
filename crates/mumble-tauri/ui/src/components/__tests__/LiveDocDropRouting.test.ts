import { describe, it, expect, beforeEach } from "vitest";
import {
  resolveDropTarget,
  useLiveDocDropStore,
} from "../chat/livedoc/liveDocDropStore";

function rect(left: number, top: number, right: number, bottom: number) {
  return { left, top, right, bottom };
}

describe("resolveDropTarget", () => {
  const liveRect = rect(0, 0, 1000, 300);

  it("routes everything to chat when no live doc is open", () => {
    expect(resolveDropTarget({ mode: "none", point: { x: 10, y: 10 }, liveDocRect: null })).toBe("chat");
    expect(resolveDropTarget({ mode: "none", point: { x: 10, y: 10 }, liveDocRect: liveRect })).toBe("chat");
  });

  it("routes everything to the live doc when maximised (chat hidden)", () => {
    expect(resolveDropTarget({ mode: "max", point: { x: 10, y: 9999 }, liveDocRect: liveRect })).toBe("livedoc");
    expect(resolveDropTarget({ mode: "max", point: { x: 10, y: 10 }, liveDocRect: null })).toBe("livedoc");
  });

  describe("half mode uses geometry", () => {
    it("targets the live doc when the pointer is inside its rect", () => {
      expect(resolveDropTarget({ mode: "half", point: { x: 500, y: 150 }, liveDocRect: liveRect })).toBe("livedoc");
    });

    it("targets the chat when the pointer is below the live doc rect", () => {
      expect(resolveDropTarget({ mode: "half", point: { x: 500, y: 400 }, liveDocRect: liveRect })).toBe("chat");
    });

    it("targets the chat when the live doc rect is unavailable", () => {
      expect(resolveDropTarget({ mode: "half", point: { x: 500, y: 150 }, liveDocRect: null })).toBe("chat");
    });

    it("includes the rect edges as inside the live doc", () => {
      expect(resolveDropTarget({ mode: "half", point: { x: 0, y: 0 }, liveDocRect: liveRect })).toBe("livedoc");
      expect(resolveDropTarget({ mode: "half", point: { x: 1000, y: 300 }, liveDocRect: liveRect })).toBe("livedoc");
    });
  });
});

describe("useLiveDocDropStore", () => {
  beforeEach(() => {
    useLiveDocDropStore.getState().unregisterTarget();
  });

  it("registers and unregisters a drop target", () => {
    const getRect = () => null;
    const insertImages = () => {};
    useLiveDocDropStore.getState().registerTarget(getRect, insertImages);
    expect(useLiveDocDropStore.getState().getRect).toBe(getRect);
    expect(useLiveDocDropStore.getState().insertImages).toBe(insertImages);

    useLiveDocDropStore.getState().unregisterTarget();
    expect(useLiveDocDropStore.getState().getRect).toBeNull();
    expect(useLiveDocDropStore.getState().insertImages).toBeNull();
  });

  it("clears dragOver when unregistering", () => {
    useLiveDocDropStore.getState().setDragOver(true);
    expect(useLiveDocDropStore.getState().dragOver).toBe(true);
    useLiveDocDropStore.getState().unregisterTarget();
    expect(useLiveDocDropStore.getState().dragOver).toBe(false);
  });
});
