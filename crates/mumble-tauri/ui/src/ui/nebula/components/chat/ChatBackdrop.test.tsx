import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
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
/** The backend's still bake. Pending forever unless a test answers it. */
const processBackgroundImage = vi.fn<(name: string, sigma: number, dim: number) => Promise<string>>(
  () => new Promise<string>(() => undefined),
);
const pruneChatBackgrounds = vi.fn<(keep: readonly string[]) => Promise<void>>(async () => undefined);
vi.mock("@core/features/settings/chatBackground", () => ({
  processBackgroundImage: (...a: [string, number, number]) => processBackgroundImage(...a),
  pruneChatBackgrounds: (...a: [readonly string[]]) => pruneChatBackgrounds(...a),
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
  useStoredBackgroundUrl: (name: string | null) => (name === null ? null : (store.get(name) ?? null)),
}));

const { ChatBackdrop, BLUR_GRACE_MS } = await import("./ChatBackdrop");
const { useAppStore } = await import("@core/store");
const { createNebulaTheme } = await import("@nebula/theme");
const { DEFAULT_SKIN } = await import("@nebula/themeCatalog");
const { PERSONALIZATION_DEFAULTS, loadPersonalization, savePersonalization } =
  await import("@standard/personalizationStorage");

/** Seed a record and mount the backdrop over it. */
async function mount(overrides: Record<string, unknown>) {
  await savePersonalization({ ...PERSONALIZATION_DEFAULTS, ...overrides } as never);
  render(withNebulaTheme(<ChatBackdrop />));
}

const query = <T extends Element>(selector: string) => document.querySelector<T>(selector);

/**
 * The clip, once the component is done mounting it.
 *
 * The element reaching the DOM is not the end of it: the listeners and the
 * watchdog's interval go on in an effect, and a poll answers the moment the
 * node exists, which can be before that effect has run. A test that then drives
 * fake timers ticks an interval that is not there yet. The empty `act` lets the
 * effects land first.
 *
 * `wait` is `vi.waitFor` for a test that fakes `setTimeout`, which the testing
 * library's own `waitFor` polls on.
 */
async function mountedVideo(
  wait: (check: () => HTMLVideoElement) => Promise<HTMLVideoElement> = waitFor,
): Promise<HTMLVideoElement> {
  const video = await wait(() => {
    const node = query<HTMLVideoElement>("video");
    expect(node).not.toBeNull();
    return node as HTMLVideoElement;
  });
  await act(async () => {});
  return video;
}

/** The backdrop under a skin that draws the poster wordmark. */
function mountStencil() {
  const theme = createNebulaTheme("dark", null, null, { ...DEFAULT_SKIN, chrome: "stencil" });
  render(<ThemeProvider theme={theme}><ChatBackdrop /></ThemeProvider>);
}

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

    const video = await mountedVideo();
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

    const video = await mountedVideo();
    expect(video.getAttribute("src")).toBe("blob:raw");
    const filter = getComputedStyle(video).filter;
    expect(filter).toContain("blur(8px)");
    expect(filter).toContain("brightness(0.3)");
    // A stale processed poster must not be shown as if it were current.
    expect(video.getAttribute("poster")).toBe("blob:poster");
  });

  it("drops to the poster once retrying the clip stops helping", async () => {
    const load = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    try {
      await mount({
        chatBgVideo: "video-raw.mp4",
        chatBgOriginal: "bgstore:image-poster.jpg",
      });

      const video = await mountedVideo();
      // A decode failure: the element carries a MediaError when `error` fires.
      Object.defineProperty(video, "error", { value: { code: 4 } });

      // The first failures buy a fresh load each - a clip that played before
      // is worth another go.
      load.mockClear();
      for (let attempt = 0; attempt < 3; attempt++) {
        fireEvent.error(video);
        expect(query("video")).toBe(video);
      }
      expect(load).toHaveBeenCalledTimes(3);

      // Past the budget, the poster takes the column.
      fireEvent.error(video);
      await waitFor(() => {
        expect(query("video")).toBeNull();
        expect(query<HTMLImageElement>("img")?.getAttribute("src")).toBe("blob:poster");
      });
      expect(load).toHaveBeenCalledTimes(3);
    } finally {
      load.mockRestore();
      play.mockRestore();
    }
  });

  it("loads the element again when a seek never lands", async () => {
    const load = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      await mount({
        chatBgVideo: "video-raw.mp4",
        chatBgOriginal: "bgstore:image-poster.jpg",
      });

      const video = await mountedVideo();
      Object.defineProperty(video, "readyState", { value: HTMLMediaElement.HAVE_ENOUGH_DATA });
      // The wrap-around at the end of a pass, wedged: seeking, and staying so.
      Object.defineProperty(video, "seeking", { value: true });
      load.mockClear();

      // A seek is allowed to take a moment; seeking to 0 again would only ask
      // the same stuck pipeline for another position.
      vi.advanceTimersByTime(2000);
      expect(load).not.toHaveBeenCalled();
      expect(video.currentTime).toBe(0);

      vi.advanceTimersByTime(1000);
      expect(load).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
      load.mockRestore();
      play.mockRestore();
    }
  });

  it("keeps playing through an error the poster's loader dispatches", async () => {
    await mount({
      chatBgVideo: "video-raw.mp4",
      chatBgOriginal: "bgstore:image-poster.jpg",
    });

    const video = await mountedVideo();
    // The poster's image loader fires `error` on the <video> itself, with no
    // MediaError attached. That is not a dead clip.
    expect(video.error).toBeFalsy();
    fireEvent.error(video);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(query("video")).toBe(video);
  });

  it("starts over when the clip reports it ended", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    await mount({
      chatBgVideo: "video-raw.mp4",
      chatBgOriginal: "bgstore:image-poster.jpg",
    });

    const video = await mountedVideo();
    video.currentTime = 17;
    play.mockClear();
    fireEvent.ended(video);

    expect(video.currentTime).toBe(0);
    expect(play).toHaveBeenCalledTimes(1);
    play.mockRestore();
  });

  it("parks the clip once the window has been unfocused, and resumes on focus", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const focused = vi.spyOn(document, "hasFocus").mockReturnValue(true);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    try {
      await mount({
        chatBgVideo: "video-raw.mp4",
        chatBgOriginal: "bgstore:image-poster.jpg",
      });
      await vi.waitFor(() => {
        expect(query<HTMLVideoElement>("video")).not.toBeNull();
      });

      // Unfocused but still on screen: the clip is given its grace period.
      focused.mockReturnValue(false);
      pause.mockClear();
      fireEvent.blur(window);
      vi.advanceTimersByTime(BLUR_GRACE_MS - 1000);
      expect(pause).not.toHaveBeenCalled();

      // Grace spent: a window nobody is looking at stops paying for frames.
      vi.advanceTimersByTime(1000);
      expect(pause).toHaveBeenCalledTimes(1);

      // Back in front: playing again, from where it stopped.
      focused.mockReturnValue(true);
      play.mockClear();
      fireEvent.focus(window);
      expect(play).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
      focused.mockRestore();
      pause.mockRestore();
      play.mockRestore();
    }
  });

  it("leaves a parked clip alone instead of restarting it", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const focused = vi.spyOn(document, "hasFocus").mockReturnValue(false);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    try {
      await mount({
        chatBgVideo: "video-raw.mp4",
        chatBgOriginal: "bgstore:image-poster.jpg",
      });
      const video = await mountedVideo(vi.waitFor);
      Object.defineProperty(video, "readyState", { value: HTMLMediaElement.HAVE_ENOUGH_DATA });
      Object.defineProperty(video, "seeking", { value: false });

      // Parked, so its position is frozen on purpose.
      vi.advanceTimersByTime(BLUR_GRACE_MS);
      expect(pause).toHaveBeenCalled();
      video.currentTime = 12;
      play.mockClear();

      // The watchdog exists for a clip that stopped on its own; this one did
      // not, and must not be seeked back to the start behind the reader.
      vi.advanceTimersByTime(5000);
      expect(video.currentTime).toBe(12);
      expect(play).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      focused.mockRestore();
      pause.mockRestore();
      play.mockRestore();
    }
  });

  /// Park the wallpaper the way losing focus does, and hand back the element.
  async function parked() {
    const video = await mountedVideo(vi.waitFor);
    Object.defineProperty(video, "readyState", { value: HTMLMediaElement.HAVE_ENOUGH_DATA });
    Object.defineProperty(video, "seeking", { value: false });
    vi.advanceTimersByTime(BLUR_GRACE_MS);
    return video;
  }

  it("resumes on focus even while the window still says it is not focused", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    // This webview can still answer `false` at the moment the window comes
    // forward, which is what used to leave the wallpaper stopped for good.
    const focused = vi.spyOn(document, "hasFocus").mockReturnValue(false);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    try {
      await mount({ chatBgVideo: "video-raw.mp4", chatBgOriginal: "bgstore:image-poster.jpg" });
      const video = await parked();
      expect(pause).toHaveBeenCalled();
      video.currentTime = 21;
      play.mockClear();

      fireEvent.focus(window);
      expect(play).toHaveBeenCalledTimes(1);
      // Picked up where it stopped, not restarted from the top.
      expect(video.currentTime).toBe(21);
    } finally {
      vi.useRealTimers();
      focused.mockRestore();
      pause.mockRestore();
      play.mockRestore();
    }
  });

  it("ends a park whose reason has gone, with no event to say so", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const focused = vi.spyOn(document, "hasFocus").mockReturnValue(false);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    try {
      await mount({ chatBgVideo: "video-raw.mp4", chatBgOriginal: "bgstore:image-poster.jpg" });
      const video = await parked();
      expect(pause).toHaveBeenCalled();
      video.currentTime = 30;
      play.mockClear();

      // The window is back in front and nothing announced it. Parking is also
      // what tells the watchdog to keep its hands off, so without this the
      // wallpaper stays on one frame for the rest of the session.
      focused.mockReturnValue(true);
      vi.advanceTimersByTime(1000);
      expect(play).toHaveBeenCalledTimes(1);
      expect(video.currentTime).toBe(30);
    } finally {
      vi.useRealTimers();
      focused.mockRestore();
      pause.mockRestore();
      play.mockRestore();
    }
  });

  it("takes a pointer over the page as the last word on a park", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    // Focus never comes back, by the window's account.
    const focused = vi.spyOn(document, "hasFocus").mockReturnValue(false);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    try {
      await mount({ chatBgVideo: "video-raw.mp4", chatBgOriginal: "bgstore:image-poster.jpg" });
      const video = await parked();
      expect(pause).toHaveBeenCalled();
      video.currentTime = 12;
      play.mockClear();

      document.dispatchEvent(new Event("pointermove"));
      expect(play).toHaveBeenCalledTimes(1);
      expect(video.currentTime).toBe(12);
    } finally {
      vi.useRealTimers();
      focused.mockRestore();
      pause.mockRestore();
      play.mockRestore();
    }
  });

  it("restarts a clip that stopped advancing while it claims to play", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    // Only the watchdog's interval is faked; `waitFor` keeps its real clock.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      await mount({
        chatBgVideo: "video-raw.mp4",
        chatBgOriginal: "bgstore:image-poster.jpg",
      });

      const video = await mountedVideo();
      Object.defineProperty(video, "readyState", { value: HTMLMediaElement.HAVE_ENOUGH_DATA });
      Object.defineProperty(video, "seeking", { value: false });

      // Advancing: the watchdog leaves it alone.
      video.currentTime = 4;
      vi.advanceTimersByTime(1000);
      video.currentTime = 5;
      vi.advanceTimersByTime(1000);
      play.mockClear();

      // Frozen at 5 for two samples: restart from the top.
      vi.advanceTimersByTime(1000);
      expect(play).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1000);
      expect(video.currentTime).toBe(0);
      expect(play).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
      play.mockRestore();
    }
  });

  it("shows the poster when the stored clip is gone", async () => {
    store.delete("video-raw.mp4");
    await mount({
      chatBgVideo: "video-raw.mp4",
      chatBgOriginal: "bgstore:image-poster.jpg",
    });

    await waitFor(() => expect(query<HTMLImageElement>("img")?.getAttribute("src")).toBe("blob:poster"));
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

    await waitFor(() => expect(query<HTMLImageElement>("img")?.getAttribute("src")).toBe("blob:poster"));
    expect(query("video")).toBeNull();
  });
});

describe("Nebula still chat background", () => {
  beforeEach(() => {
    store.clear();
    store.set("image-still.jpg", "blob:still");
    processBackgroundImage.mockClear();
    pruneChatBackgrounds.mockClear();
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

  it("bakes an unprocessed still once and shows the result untouched", async () => {
    store.set("processed-still.jpg", "blob:still-baked");
    processBackgroundImage.mockResolvedValueOnce("processed-still.jpg");
    await mount({
      chatBgOriginal: "bgstore:image-still.jpg",
      chatBgBlurred: null,
      chatBgBlurSigma: 9,
      chatBgDim: 0.4,
      chatBgRecents: [
        {
          original: "bgstore:image-still.jpg",
          blurred: null,
          video: null,
          videoBaked: null,
          videoBakedSigma: 0,
          videoBakedDim: 0,
        },
      ],
    });

    await waitFor(() => expect(processBackgroundImage).toHaveBeenCalledWith("image-still.jpg", 9, 0.4));
    const img = await waitFor(() => {
      const node = query<HTMLImageElement>("img");
      expect(node?.getAttribute("src")).toBe("blob:still-baked");
      return node as HTMLImageElement;
    });
    expect(getComputedStyle(img).filter).not.toContain("blur");

    // The record names the file, the shelf's copy learned it too, and the
    // prune was told to keep it.
    const saved = await loadPersonalization();
    expect(saved.chatBgBlurred).toBe("bgstore:processed-still.jpg");
    expect(saved.chatBgRecents[0].blurred).toBe("bgstore:processed-still.jpg");
    expect(pruneChatBackgrounds.mock.calls.at(-1)?.[0]).toContain("processed-still.jpg");
    // Once: the record now says the look is baked in, so nothing asks again.
    expect(processBackgroundImage).toHaveBeenCalledTimes(1);
  });

  it("stays on the live filter when the bake fails", async () => {
    processBackgroundImage.mockRejectedValueOnce(new Error("no decoder"));
    await mount({
      chatBgOriginal: "bgstore:image-still.jpg",
      chatBgBlurred: null,
      chatBgBlurSigma: 3,
      chatBgDim: 0.2,
    });

    await waitFor(() => expect(processBackgroundImage).toHaveBeenCalledWith("image-still.jpg", 3, 0.2));
    const img = await waitFor(() => {
      const node = query<HTMLImageElement>("img");
      expect(node).not.toBeNull();
      return node as HTMLImageElement;
    });
    expect(img.getAttribute("src")).toBe("blob:still");
    expect(getComputedStyle(img).filter).toContain("blur(3px)");
    expect((await loadPersonalization()).chatBgBlurred).toBeNull();
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

  it("captions the room being read, not the room being spoken in", () => {
    useAppStore.setState({
      channels: [
        { id: 1, name: "green is fucked" },
        { id: 2, name: "Game for 2" },
      ] as never,
      // In voice in one room, reading another - which is every moment spent
      // browsing without leaving the call.
      currentChannel: 1,
      selectedChannel: 2,
      selectedDmUser: null,
    });

    mountStencil();

    expect(document.body.textContent).toContain("GAME FOR");
    expect(document.body.textContent).not.toContain("GREEN");
  });

  it("captions a direct message with the name at the other end", () => {
    useAppStore.setState({
      channels: [{ id: 1, name: "green is fucked" }] as never,
      users: [{ session: 7, name: "ZewiLinux", channel_id: 1 }] as never,
      currentChannel: 1,
      selectedChannel: 1,
      selectedDmUser: 7,
    });

    mountStencil();

    expect(document.body.textContent).toContain("ZEWILINUX");
    expect(document.body.textContent).not.toContain("GREEN");
  });
});
