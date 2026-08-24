import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { withNebulaTheme } from "@nebula/testTheme";

/** Every store write the page makes, newest last. */
const writes: Record<string, unknown>[] = [];
/** Set to reject the next write, standing in for a payload the store refuses. */
let writeFails = false;

vi.mock("@core/utils/store", () => {
  const mem: Record<string, unknown> = {};
  return {
    load: async () => ({
      get: async (key: string) => mem[key],
      set: async (key: string, value: Record<string, unknown>) => {
        if (writeFails) throw new Error("store write refused");
        writes.push(value);
        mem[key] = value;
      },
    }),
  };
});

// The picker dialog, the store reads and the codecs all live outside the
// webview; what is under test is what the page does with what they hand back.
const pickChatBackground = vi.fn<() => Promise<{ kind: "image" | "video"; fileName: string } | null>>();
const extractBackgroundPoster = vi.fn<() => Promise<string | null>>();
const captureAndStorePoster = vi.fn<() => Promise<string>>();
const storedBackgroundUrl = vi.fn<() => Promise<string | null>>();
const probeVideoPlayback = vi.fn<() => Promise<{ playable: boolean; reason: string | null }>>();
const bakeBackgroundVideo = vi.fn<() => Promise<string>>();
const processBackgroundImage = vi.fn<() => Promise<string>>();
const clearChatBackgroundStore = vi.fn<() => Promise<void>>();

vi.mock("@core/features/settings/chatBackground", () => ({
  isStoreRef: (v: unknown) => typeof v === "string" && v.startsWith("bgstore:"),
  toStoreRef: (name: string) => `bgstore:${name}`,
  storeRefName: (ref: string) => ref.slice("bgstore:".length),
  useResolvedBackgroundSource: (value: string | null) => value,
  pickChatBackground: () => pickChatBackground(),
  extractBackgroundPoster: (...a: unknown[]) => extractBackgroundPoster(...(a as [])),
  captureAndStorePoster: (...a: unknown[]) => captureAndStorePoster(...(a as [])),
  storedBackgroundUrl: (...a: unknown[]) => storedBackgroundUrl(...(a as [])),
  probeVideoPlayback: (...a: unknown[]) => probeVideoPlayback(...(a as [])),
  bakeBackgroundVideo: (...a: unknown[]) => bakeBackgroundVideo(...(a as [])),
  processBackgroundImage: (...a: unknown[]) => processBackgroundImage(...(a as [])),
  clearChatBackgroundStore: () => clearChatBackgroundStore(),
  onBakeProgress: () => () => undefined,
}));

const { PersonalizeSettings } = await import("./PersonalizeSettings");
const { PERSONALIZATION_DEFAULTS, savePersonalization } = await import("@standard/personalizationStorage");

const choose = () => fireEvent.click(screen.getByText(/Choose an image or video/i));

async function renderPage() {
  render(withNebulaTheme(<PersonalizeSettings />));
  await screen.findByText(/Chat background/i);
}

beforeEach(async () => {
  writeFails = false;
  for (const mock of [
    pickChatBackground,
    extractBackgroundPoster,
    captureAndStorePoster,
    storedBackgroundUrl,
    probeVideoPlayback,
    bakeBackgroundVideo,
    processBackgroundImage,
    clearChatBackgroundStore,
  ])
    mock.mockReset();
  clearChatBackgroundStore.mockResolvedValue(undefined);
  storedBackgroundUrl.mockResolvedValue("blob:clip");
  probeVideoPlayback.mockResolvedValue({ playable: true, reason: null });
  await savePersonalization({ ...PERSONALIZATION_DEFAULTS });
  writes.length = 0;
});

describe("the unified wallpaper picker", () => {
  it("is one button - no separate image and video pickers, no file input", async () => {
    await renderPage();
    expect(screen.getAllByText(/Choose an image or video/i)).toHaveLength(1);
    expect(screen.queryByText(/Choose a video/i)).toBeNull();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it("stores a picked image as a reference, never as bytes", async () => {
    pickChatBackground.mockResolvedValue({ kind: "image", fileName: "image-a.jpg" });
    await renderPage();
    choose();

    await waitFor(() => expect(writes.length).toBe(1));
    expect(writes[0].chatBgOriginal).toBe("bgstore:image-a.jpg");
    expect(writes[0].chatBgBlurred).toBeNull();
    expect(writes[0].chatBgVideo).toBeNull();
    // No data-URL anywhere in the record.
    expect(JSON.stringify(writes[0])).not.toContain("data:image");
  });

  it("writes nothing when the dialog is dismissed", async () => {
    pickChatBackground.mockResolvedValue(null);
    await renderPage();
    choose();

    await waitFor(() => expect(pickChatBackground).toHaveBeenCalled());
    expect(writes.length).toBe(0);
  });
});

describe("picking a clip", () => {
  it("stores names, takes the backend's poster, and queues the bake", async () => {
    pickChatBackground.mockResolvedValue({ kind: "video", fileName: "video-a.mp4" });
    extractBackgroundPoster.mockResolvedValue("image-poster.jpg");
    bakeBackgroundVideo.mockResolvedValue("video-baked-b.mp4");
    processBackgroundImage.mockResolvedValue("processed-poster.jpg");

    await renderPage();
    choose();

    await waitFor(() => expect(writes.length).toBeGreaterThanOrEqual(1));
    expect(writes[0].chatBgVideo).toBe("video-a.mp4");
    expect(writes[0].chatBgOriginal).toBe("bgstore:image-poster.jpg");
    // The webview never had to decode anything for this.
    expect(captureAndStorePoster).not.toHaveBeenCalled();

    // The bake lands asynchronously and stamps its parameters (defaults:
    // sigma 0, dim 0.5), together with the matching processed poster.
    await waitFor(() => {
      const last = writes.at(-1) as Record<string, unknown>;
      expect(last.chatBgVideoBaked).toBe("video-baked-b.mp4");
      expect(last.chatBgVideoBakedDim).toBe(0.5);
      expect(last.chatBgBlurred).toBe("bgstore:processed-poster.jpg");
    });
    expect(bakeBackgroundVideo).toHaveBeenCalledWith("video-a.mp4", 0, 0.5);
  });

  it("captures the poster in the webview when the backend cannot decode", async () => {
    pickChatBackground.mockResolvedValue({ kind: "video", fileName: "video-a.webm" });
    extractBackgroundPoster.mockResolvedValue(null);
    captureAndStorePoster.mockResolvedValue("image-poster.jpg");
    bakeBackgroundVideo.mockRejectedValue(new Error("not H.264"));

    await renderPage();
    choose();

    await waitFor(() => expect(writes.length).toBeGreaterThanOrEqual(1));
    expect(captureAndStorePoster).toHaveBeenCalledWith("blob:clip");
    expect(writes[0].chatBgOriginal).toBe("bgstore:image-poster.jpg");
    // The failed bake is a quiet degradation: no baked fields, no error.
    await waitFor(() => expect(bakeBackgroundVideo).toHaveBeenCalled());
    expect((writes.at(-1) as Record<string, unknown>).chatBgVideoBaked).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps nothing when no decoder anywhere can open the clip", async () => {
    pickChatBackground.mockResolvedValue({ kind: "video", fileName: "video-a.webm" });
    extractBackgroundPoster.mockResolvedValue(null);
    captureAndStorePoster.mockRejectedValue(
      new Error("This system is missing the codecs to play that video."),
    );

    await renderPage();
    choose();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/missing the codecs/i);
    expect(clearChatBackgroundStore).toHaveBeenCalled();
    // The record ends cleared, since the pick already emptied the store.
    const last = writes.at(-1) as Record<string, unknown>;
    expect(last.chatBgVideo).toBeNull();
    expect(last.chatBgOriginal).toBeNull();
  });

  it("says so when the clip stores fine but this webview cannot play it", async () => {
    pickChatBackground.mockResolvedValue({ kind: "video", fileName: "video-a.mp4" });
    extractBackgroundPoster.mockResolvedValue("image-poster.jpg");
    bakeBackgroundVideo.mockResolvedValue("video-baked-b.mp4");
    processBackgroundImage.mockResolvedValue("processed-poster.jpg");
    probeVideoPlayback.mockResolvedValue({
      playable: false,
      reason: "This system is missing the codecs to play that video.",
    });

    await renderPage();
    choose();

    const notice = await screen.findByText(/missing the codecs/i);
    expect(notice.textContent).toMatch(/still frame will show instead/i);
    // Advisory, not an error - the pick is kept.
    expect(screen.queryByRole("alert")).toBeNull();
    expect((writes[0] as Record<string, unknown>).chatBgVideo).toBe("video-a.mp4");
  });
});

describe("slider commits over an animated wallpaper", () => {
  it("re-bake with the committed parameters", async () => {
    await savePersonalization({
      ...PERSONALIZATION_DEFAULTS,
      chatBgVideo: "video-a.mp4",
      chatBgOriginal: "bgstore:image-poster.jpg",
      chatBgVideoBaked: "video-baked-old.mp4",
      chatBgVideoBakedSigma: 0,
      chatBgVideoBakedDim: 0.5,
    });
    writes.length = 0;
    bakeBackgroundVideo.mockResolvedValue("video-baked-new.mp4");
    processBackgroundImage.mockResolvedValue("processed-new.jpg");

    await renderPage();
    const slider = screen.getByLabelText("Blur");
    fireEvent.change(slider, { target: { value: "12" } });
    fireEvent.mouseUp(slider);

    await waitFor(() => expect(bakeBackgroundVideo).toHaveBeenCalledWith("video-a.mp4", 12, 0.5));
    await waitFor(() => {
      const last = writes.at(-1) as Record<string, unknown>;
      expect(last.chatBgVideoBaked).toBe("video-baked-new.mp4");
      expect(last.chatBgVideoBakedSigma).toBe(12);
    });
  });
});

describe("failure honesty", () => {
  it("says so when the record write is refused instead of looking like it worked", async () => {
    pickChatBackground.mockResolvedValue({ kind: "image", fileName: "image-a.jpg" });
    await renderPage();
    writeFails = true;
    choose();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/store write refused/i);
    expect(writes.length).toBe(0);
  });
});
