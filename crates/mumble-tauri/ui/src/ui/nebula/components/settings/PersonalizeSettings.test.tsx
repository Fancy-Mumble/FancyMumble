import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
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
const pruneChatBackgrounds = vi.fn<(keep: readonly string[]) => Promise<void>>();

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
  pruneChatBackgrounds: (...a: unknown[]) => pruneChatBackgrounds(...(a as [string[]])),
  onBakeProgress: () => () => undefined,
}));

/** A stored still, in the shape the record's shelf keeps it. */
const still = (name: string) => ({
  original: `bgstore:${name}`,
  blurred: null,
  video: null,
  videoBaked: null,
  videoBakedSigma: 0,
  videoBakedDim: 0,
});

/** The `original`s on the shelf a write left behind, newest first. */
const shelfOf = (write: Record<string, unknown>) =>
  (write.chatBgRecents as { original: string }[]).map((entry) => entry.original);

/** The keep-list of the last prune, sorted so order is not part of the claim. */
const lastPruneKeep = () => [...(pruneChatBackgrounds.mock.calls.at(-1)?.[0] ?? [])].sort();

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
    pruneChatBackgrounds,
  ])
    mock.mockReset();
  clearChatBackgroundStore.mockResolvedValue(undefined);
  pruneChatBackgrounds.mockResolvedValue(undefined);
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

  it("leaves the wallpaper that was up alone when no decoder can open the clip", async () => {
    await savePersonalization({
      ...PERSONALIZATION_DEFAULTS,
      chatBgOriginal: "bgstore:image-old.jpg",
      chatBgRecents: [still("image-old.jpg")],
    });
    writes.length = 0;
    pickChatBackground.mockResolvedValue({ kind: "video", fileName: "video-a.webm" });
    extractBackgroundPoster.mockResolvedValue(null);
    captureAndStorePoster.mockRejectedValue(
      new Error("This system is missing the codecs to play that video."),
    );

    await renderPage();
    choose();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/missing the codecs/i);
    // A pick only adds files now, so a failed one costs nothing: the record
    // is untouched and only the half-stored clip is swept up.
    expect(clearChatBackgroundStore).not.toHaveBeenCalled();
    expect(writes.length).toBe(0);
    await waitFor(() => expect(lastPruneKeep()).toEqual(["image-old.jpg"]));
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

describe("the wallpaper shelf", () => {
  it("keeps the wallpaper it replaced instead of deleting it", async () => {
    await renderPage();

    pickChatBackground.mockResolvedValue({ kind: "image", fileName: "image-a.jpg" });
    choose();
    await waitFor(() => expect(writes.length).toBe(1));

    pickChatBackground.mockResolvedValue({ kind: "image", fileName: "image-b.jpg" });
    choose();
    await waitFor(() => expect(writes.length).toBe(2));

    const last = writes.at(-1) as Record<string, unknown>;
    expect(last.chatBgOriginal).toBe("bgstore:image-b.jpg");
    expect(shelfOf(last)).toEqual(["bgstore:image-b.jpg", "bgstore:image-a.jpg"]);
    // Both sets of files survive - which is the whole point, and exactly what
    // the store used to make impossible.
    await waitFor(() => expect(lastPruneKeep()).toEqual(["image-a.jpg", "image-b.jpg"]));
  });

  it("holds five and lets the sixth push the oldest off", async () => {
    await savePersonalization({
      ...PERSONALIZATION_DEFAULTS,
      chatBgOriginal: "bgstore:image-5.jpg",
      chatBgRecents: [1, 2, 3, 4, 5].map((n) => still(`image-${n}.jpg`)).reverse(),
    });
    writes.length = 0;
    pickChatBackground.mockResolvedValue({ kind: "image", fileName: "image-6.jpg" });

    await renderPage();
    choose();

    await waitFor(() => expect(writes.length).toBe(1));
    const shelf = shelfOf(writes[0] as Record<string, unknown>);
    expect(shelf).toHaveLength(5);
    expect(shelf[0]).toBe("bgstore:image-6.jpg");
    expect(shelf).not.toContain("bgstore:image-1.jpg");
    // The one that fell off the end is the one whose files get collected.
    await waitFor(() =>
      expect(lastPruneKeep()).toEqual([
        "image-2.jpg",
        "image-3.jpg",
        "image-4.jpg",
        "image-5.jpg",
        "image-6.jpg",
      ]),
    );
  });

  it("switches to a saved wallpaper without opening the picker", async () => {
    await savePersonalization({
      ...PERSONALIZATION_DEFAULTS,
      chatBgOriginal: "bgstore:image-b.jpg",
      chatBgRecents: [still("image-b.jpg"), still("image-a.jpg")],
    });
    writes.length = 0;

    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Saved" }));

    await waitFor(() => expect(writes.length).toBe(1));
    const last = writes.at(-1) as Record<string, unknown>;
    expect(last.chatBgOriginal).toBe("bgstore:image-a.jpg");
    // No dialog, no re-copy, no re-decode - and the shelf is unchanged, so
    // switching back and forth never reorders the tiles under the cursor.
    expect(pickChatBackground).not.toHaveBeenCalled();
    expect(shelfOf(last)).toEqual(["bgstore:image-b.jpg", "bgstore:image-a.jpg"]);
    await waitFor(() => expect(lastPruneKeep()).toEqual(["image-a.jpg", "image-b.jpg"]));
  });

  it("shows no wallpaper for Default, and keeps the shelf anyway", async () => {
    await savePersonalization({
      ...PERSONALIZATION_DEFAULTS,
      chatBgOriginal: "bgstore:image-a.jpg",
      chatBgRecents: [still("image-a.jpg")],
    });
    writes.length = 0;

    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Default/ }));

    await waitFor(() => expect(writes.length).toBe(1));
    const last = writes.at(-1) as Record<string, unknown>;
    expect(last.chatBgOriginal).toBeNull();
    // "Not showing it" stopped meaning "not having it" the moment there was
    // more than one to have.
    expect(shelfOf(last)).toEqual(["bgstore:image-a.jpg"]);
    await waitFor(() => expect(lastPruneKeep()).toEqual(["image-a.jpg"]));
  });

  it("throws a wallpaper away only when asked, and takes its files with it", async () => {
    await savePersonalization({
      ...PERSONALIZATION_DEFAULTS,
      chatBgOriginal: "bgstore:image-b.jpg",
      chatBgRecents: [still("image-b.jpg"), still("image-a.jpg")],
    });
    writes.length = 0;

    await renderPage();
    const [, saved] = screen.getAllByRole("button", { name: "Remove this background" });
    fireEvent.click(saved);

    await waitFor(() => expect(writes.length).toBe(1));
    const last = writes.at(-1) as Record<string, unknown>;
    expect(shelfOf(last)).toEqual(["bgstore:image-b.jpg"]);
    // Still the wallpaper on screen; only the one let go is collected.
    expect(last.chatBgOriginal).toBe("bgstore:image-b.jpg");
    await waitFor(() => expect(lastPruneKeep()).toEqual(["image-b.jpg"]));
  });

  it("gives a wallpaper set before the shelf existed a tile of its own", async () => {
    await savePersonalization({
      ...PERSONALIZATION_DEFAULTS,
      chatBgOriginal: "bgstore:image-legacy.jpg",
    });
    writes.length = 0;

    await renderPage();

    // Nothing on the shelf, yet the picture is on screen - it still gets a
    // tile, so the picker never draws a wallpaper the user cannot switch back
    // to.
    expect(screen.getByRole("button", { name: "Current" })).toBeTruthy();
  });
});

describe("the focus point", () => {
  it("is offered only once there is a picture to frame", async () => {
    await renderPage();
    expect(screen.queryByRole("group", { name: "Focus point" })).toBeNull();
  });

  it("nudges with the arrow keys, and remembers the framing on the shelf", async () => {
    await savePersonalization({
      ...PERSONALIZATION_DEFAULTS,
      chatBgOriginal: "bgstore:image-a.jpg",
      chatBgRecents: [still("image-a.jpg")],
    });
    writes.length = 0;

    await renderPage();
    const picker = screen.getByRole("group", { name: "Focus point" });
    // A pointer is the quick way; jsdom has no layout to click into, and the
    // keys are what anyone without a pointer has anyway.
    fireEvent.keyDown(picker, { key: "ArrowUp" });

    await waitFor(() => expect(writes.length).toBe(1));
    const last = writes.at(-1) as Record<string, unknown>;
    expect(last.chatBgFocusY).toBeCloseTo(0.48);
    expect(last.chatBgFocusX).toBe(0.5);
    // On the shelf too: where a face sits is a fact about the picture, so it
    // has to survive a trip to another wallpaper and back.
    expect((last.chatBgRecents as { focusY: number }[])[0].focusY).toBeCloseTo(0.48);
  });

  it("stops at the edge of the picture", async () => {
    await savePersonalization({
      ...PERSONALIZATION_DEFAULTS,
      chatBgOriginal: "bgstore:image-a.jpg",
      chatBgFocusY: 0.01,
      chatBgRecents: [still("image-a.jpg")],
    });
    writes.length = 0;

    await renderPage();
    fireEvent.keyDown(screen.getByRole("group", { name: "Focus point" }), { key: "ArrowUp" });

    await waitFor(() => expect(writes.length).toBe(1));
    // Not -0.01: a focus point outside the picture has no meaning, and CSS
    // would happily take it.
    expect((writes.at(-1) as Record<string, unknown>).chatBgFocusY).toBe(0);
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

describe("how the message river is drawn", () => {
  it("writes the text-size preset the chat reads", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("radio", { name: "Small" }));

    await waitFor(() => expect(writes.at(-1)?.fontSize).toBe("small"));
  });

  it("keeps the per-pixel size behind expert mode", async () => {
    await renderPage();
    expect(screen.queryByLabelText("Custom size")).toBeNull();
  });

  it("writes compact mode and always-visible actions", async () => {
    await renderPage();

    fireEvent.click(screen.getByLabelText("Compact mode"));
    await waitFor(() => expect(writes.at(-1)?.compactMode).toBe(true));

    fireEvent.click(screen.getByLabelText("Always show message actions"));
    await waitFor(() => expect(writes.at(-1)?.alwaysShowMessageActions).toBe(true));
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

describe("a channel viewer this pack does not draw", () => {
  it("says whose choice it is showing when Standard left \"classic\" behind", async () => {
    await savePersonalization({ ...PERSONALIZATION_DEFAULTS, channelViewerStyle: "classic" });
    await renderPage();
    // Not "Flat, as you chose" - the user chose Classic, and the page has to
    // own the substitution rather than present it as their own selection.
    expect(await screen.findByText(/Standard's "Classic" saved/i)).toBeTruthy();
    expect(screen.getByText(/no collapsing folders/i)).toBeTruthy();
  });

  it("still selects the style it actually draws", async () => {
    await savePersonalization({ ...PERSONALIZATION_DEFAULTS, channelViewerStyle: "classic" });
    await renderPage();
    // Scoped to this group: "Flat" is a label other pickers on the page use too.
    const group = screen.getByRole("radiogroup", { name: "Channel viewer" });
    const flat = within(group).getByRole("radio", { name: "Flat" });
    expect(flat.getAttribute("aria-checked")).toBe("true");
  });

  it("explains nothing when the stored style is one it draws", async () => {
    for (const style of ["flat", "modern"] as const) {
      await savePersonalization({ ...PERSONALIZATION_DEFAULTS, channelViewerStyle: style });
      const { unmount } = render(withNebulaTheme(<PersonalizeSettings />));
      await screen.findByText(/Chat background/i);
      expect(screen.queryByText(/Standard's "Classic" saved/i)).toBeNull();
      unmount();
    }
  });
});

