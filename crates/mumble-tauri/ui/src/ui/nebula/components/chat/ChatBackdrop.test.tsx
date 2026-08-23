import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { withNebulaTheme } from "@nebula/testTheme";

vi.mock("@core/utils/store", () => {
  const mem: Record<string, unknown> = {};
  return {
    load: async () => ({
      get: async (key: string) => mem[key],
      set: async (key: string, value: Record<string, unknown>) => {
        mem[key] = value;
      },
    }),
  };
});

/** Stands in for the backend store: file name -> blob URL. */
const store = new Map<string, string>();
vi.mock("@core/features/settings/chatBackground", () => ({
  isStoreRef: (v: unknown) => typeof v === "string" && v.startsWith("bgstore:"),
  toStoreRef: (name: string) => `bgstore:${name}`,
  storeRefName: (ref: string) => ref.slice("bgstore:".length),
  // Pure lookups are legal hook stand-ins - no state, no effects.
  useResolvedBackgroundSource: (value: string | null) =>
    value === null
      ? null
      : value.startsWith("bgstore:")
        ? (store.get(value.slice("bgstore:".length)) ?? null)
        : value,
  useStoredBackgroundUrl: (name: string | null) =>
    name === null ? null : (store.get(name) ?? null),
}));

const { ChatBackdrop } = await import("./ChatBackdrop");
const { PERSONALIZATION_DEFAULTS, savePersonalization } = await import(
  "@standard/personalizationStorage"
);

/** Seed a record and mount the backdrop over it. */
async function mount(overrides: Record<string, unknown>) {
  await savePersonalization({ ...PERSONALIZATION_DEFAULTS, ...overrides } as never);
  render(withNebulaTheme(<ChatBackdrop />));
}

const query = <T extends Element>(selector: string) => document.querySelector<T>(selector);

describe("Nebula animated chat background", () => {
  beforeEach(() => {
    store.clear();
    store.set("video-raw.mp4", "blob:raw");
    store.set("video-baked-x.mp4", "blob:baked");
    store.set("image-poster.jpg", "blob:poster");
    store.set("processed-poster.jpg", "blob:poster-processed");
  });

  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(globalThis, "matchMedia");
  });

  it("plays the baked clip with no CSS filter when its parameters are current", async () => {
    await mount({
      chatBgVideo: "video-raw.mp4",
      chatBgVideoBaked: "video-baked-x.mp4",
      chatBgVideoBakedSigma: 8,
      chatBgVideoBakedDim: 0.4,
      chatBgBlurSigma: 8,
      chatBgDim: 0.4,
      chatBgOriginal: "bgstore:image-poster.jpg",
      chatBgBlurred: "bgstore:processed-poster.jpg",
    });

    const video = await waitFor(() => {
      const node = query<HTMLVideoElement>("video");
      expect(node).not.toBeNull();
      return node as HTMLVideoElement;
    });
    // The optimized file, not the raw clip.
    expect(video.getAttribute("src")).toBe("blob:baked");
    // The look is in the pixels; only the saturation nudge remains.
    const filter = getComputedStyle(video).filter;
    expect(filter).not.toContain("blur");
    expect(filter).not.toContain("brightness");
    expect(video.hasAttribute("loop")).toBe(true);
    expect(video.muted).toBe(true);
    // The poster matches the baked look, since they were produced together.
    expect(video.getAttribute("poster")).toBe("blob:poster-processed");
  });

  it("falls back to the raw clip under a live filter while the bake is stale", async () => {
    await mount({
      chatBgVideo: "video-raw.mp4",
      chatBgVideoBaked: "video-baked-x.mp4",
      chatBgVideoBakedSigma: 8,
      chatBgVideoBakedDim: 0.4,
      // The dim slider moved after the bake.
      chatBgBlurSigma: 8,
      chatBgDim: 0.7,
      chatBgOriginal: "bgstore:image-poster.jpg",
      chatBgBlurred: "bgstore:processed-poster.jpg",
    });

    const video = await waitFor(() => {
      const node = query<HTMLVideoElement>("video");
      expect(node).not.toBeNull();
      return node as HTMLVideoElement;
    });
    expect(video.getAttribute("src")).toBe("blob:raw");
    const filter = getComputedStyle(video).filter;
    expect(filter).toContain("blur(8px)");
    expect(filter).toContain("brightness(0.3)");
    // A stale processed poster must not be shown as if it were current.
    expect(video.getAttribute("poster")).toBe("blob:poster");
  });

  it("drops to the poster when the webview cannot play the clip", async () => {
    await mount({
      chatBgVideo: "video-raw.mp4",
      chatBgOriginal: "bgstore:image-poster.jpg",
    });

    const video = await waitFor(() => {
      const node = query<HTMLVideoElement>("video");
      expect(node).not.toBeNull();
      return node as HTMLVideoElement;
    });
    fireEvent.error(video);

    await waitFor(() => {
      expect(query("video")).toBeNull();
      expect(query<HTMLImageElement>("img")?.getAttribute("src")).toBe("blob:poster");
    });
  });

  it("shows the poster when the stored clip is gone", async () => {
    store.delete("video-raw.mp4");
    await mount({
      chatBgVideo: "video-raw.mp4",
      chatBgOriginal: "bgstore:image-poster.jpg",
    });

    await waitFor(() =>
      expect(query<HTMLImageElement>("img")?.getAttribute("src")).toBe("blob:poster"),
    );
    expect(query("video")).toBeNull();
  });

  it("holds still for a reader who asked for less motion", async () => {
    Object.defineProperty(globalThis, "matchMedia", {
      configurable: true,
      value: (q: string) => ({
        matches: q.includes("prefers-reduced-motion"),
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
    });

    await mount({
      chatBgVideo: "video-raw.mp4",
      chatBgOriginal: "bgstore:image-poster.jpg",
    });

    await waitFor(() =>
      expect(query<HTMLImageElement>("img")?.getAttribute("src")).toBe("blob:poster"),
    );
    expect(query("video")).toBeNull();
  });
});

describe("Nebula still chat background", () => {
  beforeEach(() => {
    store.clear();
    store.set("image-still.jpg", "blob:still");
  });
  afterEach(cleanup);

  it("dims and blurs an unprocessed still through the live filter", async () => {
    await mount({
      chatBgOriginal: "bgstore:image-still.jpg",
      chatBgBlurred: null,
      chatBgBlurSigma: 6,
      chatBgDim: 0.5,
    });

    const img = await waitFor(() => {
      const node = query<HTMLImageElement>("img");
      expect(node).not.toBeNull();
      return node as HTMLImageElement;
    });
    expect(img.getAttribute("src")).toBe("blob:still");
    const filter = getComputedStyle(img).filter;
    expect(filter).toContain("blur(6px)");
    expect(filter).toContain("brightness(0.5)");
    // The dim darkens the picture, never a sheet over the whole conversation.
    const sheets = [...document.querySelectorAll("div")].filter((node) =>
      getComputedStyle(node).background.includes("rgb(0, 0, 0)"),
    );
    expect(sheets).toHaveLength(0);
  });

  it("shows a processed still untouched - its look is already baked in", async () => {
    await mount({
      chatBgOriginal: "data:image/jpeg;base64,ORIGINAL",
      chatBgBlurred: "data:image/jpeg;base64,BAKED",
      chatBgBlurSigma: 6,
      chatBgDim: 0.5,
    });

    const img = await waitFor(() => {
      const node = query<HTMLImageElement>("img");
      expect(node).not.toBeNull();
      return node as HTMLImageElement;
    });
    expect(img.getAttribute("src")).toBe("data:image/jpeg;base64,BAKED");
    const filter = getComputedStyle(img).filter;
    expect(filter).not.toContain("blur");
    expect(filter).not.toContain("brightness");
  });
});
