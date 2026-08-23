import { describe, it, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...(a as [])) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => undefined) }));

const {
  isStoreRef,
  toStoreRef,
  storeRefName,
  storedBackgroundUrl,
  resolveBackgroundSource,
  releaseStoredBackgrounds,
} = await import("./chatBackground");

// jsdom has no object URLs; count creations so caching is observable.
let created = 0;
beforeEach(() => {
  invoke.mockReset();
  created = 0;
  Object.assign(URL, {
    createObjectURL: () => `blob:test-${++created}`,
    revokeObjectURL: () => undefined,
  });
  releaseStoredBackgrounds();
});

describe("store references", () => {
  it("round-trip and never mistake data-URLs for refs", () => {
    const ref = toStoreRef("video-a.mp4");
    expect(ref).toBe("bgstore:video-a.mp4");
    expect(isStoreRef(ref)).toBe(true);
    expect(storeRefName(ref)).toBe("video-a.mp4");
    expect(isStoreRef("data:image/jpeg;base64,x")).toBe(false);
    expect(isStoreRef(null)).toBe(false);
  });
});

describe("storedBackgroundUrl", () => {
  it("reads bytes over binary IPC once, then serves the cached blob URL", async () => {
    invoke.mockResolvedValue(new ArrayBuffer(8));

    const first = await storedBackgroundUrl("video-a.mp4");
    const second = await storedBackgroundUrl("video-a.mp4");
    expect(first).toBe("blob:test-1");
    expect(second).toBe(first);
    // One IPC read for two consumers - the whole point of the cache.
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("read_chat_background", { fileName: "video-a.mp4" });
  });

  it("returns null for a file the store no longer has", async () => {
    invoke.mockRejectedValue(new Error("no stored background named gone.mp4"));
    expect(await storedBackgroundUrl("gone.mp4")).toBeNull();
  });
});

describe("resolveBackgroundSource", () => {
  it("passes data-URLs through untouched and resolves refs", async () => {
    invoke.mockResolvedValue(new ArrayBuffer(8));
    expect(await resolveBackgroundSource("data:image/jpeg;base64,x")).toBe(
      "data:image/jpeg;base64,x",
    );
    expect(await resolveBackgroundSource(null)).toBeNull();
    expect(await resolveBackgroundSource("bgstore:image-a.jpg")).toBe("blob:test-1");
  });
});
