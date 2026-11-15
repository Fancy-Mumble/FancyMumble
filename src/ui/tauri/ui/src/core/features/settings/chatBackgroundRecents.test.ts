import { describe, it, expect, vi } from "vitest";

// The module borrows two ref helpers from the transfer layer, which pulls in
// Tauri's IPC. Nothing here goes near it.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => undefined) }));

const {
  activeBackground,
  forgetBackground,
  hasBackground,
  isSameBackground,
  referencedFiles,
  rememberBackground,
  showBackground,
  updateBackground,
} = await import("./chatBackgroundRecents");
const { PERSONALIZATION_DEFAULTS, CHAT_BG_RECENTS_MAX } = await import(
  "@standard/personalizationStorage"
);

type Entry = ReturnType<typeof activeBackground>;

const still = (name: string): Entry => ({
  original: `bgstore:${name}`,
  blurred: null,
  video: null,
  videoBaked: null,
  videoBakedSigma: 0,
  videoBakedDim: 0,
});

const clip = (name: string, poster: string): Entry => ({
  original: `bgstore:${poster}`,
  blurred: null,
  video: name,
  videoBaked: null,
  videoBakedSigma: 0,
  videoBakedDim: 0,
});

describe("the shelf", () => {
  it("puts the newest pick first and drops the oldest past the cap", () => {
    let shelf: Entry[] = [];
    for (let n = 1; n <= CHAT_BG_RECENTS_MAX + 2; n++)
      shelf = rememberBackground(shelf, still(`image-${n}.jpg`));

    expect(shelf).toHaveLength(CHAT_BG_RECENTS_MAX);
    expect(shelf[0].original).toBe(`bgstore:image-${CHAT_BG_RECENTS_MAX + 2}.jpg`);
    expect(shelf.map((entry) => entry.original)).not.toContain("bgstore:image-1.jpg");
  });

  it("moves a re-picked wallpaper rather than keeping two of it", () => {
    const shelf = rememberBackground(
      [still("image-b.jpg"), still("image-a.jpg")],
      still("image-a.jpg"),
    );
    expect(shelf.map((entry) => entry.original)).toEqual([
      "bgstore:image-a.jpg",
      "bgstore:image-b.jpg",
    ]);
  });

  it("never remembers the default state as a wallpaper", () => {
    const empty = showBackground(null);
    const entry = activeBackground({ ...PERSONALIZATION_DEFAULTS, ...empty });
    expect(hasBackground(entry)).toBe(false);
    expect(rememberBackground([still("image-a.jpg")], entry)).toHaveLength(1);
  });

  it("knows a wallpaper by its picked files, not by its derived ones", () => {
    const baked: Entry = { ...clip("video-a.mp4", "image-p.jpg"), videoBaked: "video-baked-x.mp4" };
    // A bake lands and the entry now points at another file - still the same
    // wallpaper, or the shelf would fill up with copies of one picture.
    expect(isSameBackground(clip("video-a.mp4", "image-p.jpg"), baked)).toBe(true);
    expect(isSameBackground(still("image-a.jpg"), still("image-b.jpg"))).toBe(false);
  });

  it("refreshes an entry in place, so a finished bake does not reorder tiles", () => {
    const shelf = [still("image-b.jpg"), clip("video-a.mp4", "image-p.jpg")];
    const baked: Entry = {
      ...clip("video-a.mp4", "image-p.jpg"),
      videoBaked: "video-baked-x.mp4",
      videoBakedDim: 0.5,
    };
    const updated = updateBackground(shelf, baked);

    expect(updated[0].original).toBe("bgstore:image-b.jpg");
    expect(updated[1].videoBaked).toBe("video-baked-x.mp4");
  });

  it("takes a wallpaper off when asked", () => {
    const shelf = forgetBackground([still("image-a.jpg"), still("image-b.jpg")], still("image-a.jpg"));
    expect(shelf.map((entry) => entry.original)).toEqual(["bgstore:image-b.jpg"]);
  });
});

describe("round-tripping a wallpaper through the live fields", () => {
  it("survives showing and reading back", () => {
    const entry = {
      ...clip("video-a.mp4", "image-p.jpg"),
      videoBaked: "video-baked-x.mp4",
      focusX: 0.3,
      focusY: 0.12,
    };
    const record = { ...PERSONALIZATION_DEFAULTS, ...showBackground(entry) };
    expect(activeBackground(record)).toEqual(entry);
  });

  it("clears every field for the default state", () => {
    const record = {
      ...PERSONALIZATION_DEFAULTS,
      ...showBackground(clip("video-a.mp4", "image-p.jpg")),
      ...showBackground(null),
    };
    expect(activeBackground(record)).toEqual({
      original: null,
      blurred: null,
      video: null,
      videoBaked: null,
      videoBakedSigma: 0,
      videoBakedDim: 0,
      focusX: 0.5,
      focusY: 0.5,
    });
  });
});

describe("the focus point", () => {
  it("rides along with the wallpaper, not with the window", () => {
    const framed: Entry = { ...still("image-a.jpg"), focusX: 0.5, focusY: 0.18 };
    const shelf = updateBackground([still("image-b.jpg"), still("image-a.jpg")], framed);
    const record = { ...PERSONALIZATION_DEFAULTS, ...showBackground(shelf[1]) };

    expect(record.chatBgFocusY).toBe(0.18);
    // Switching to the other wallpaper does not carry the framing over: the
    // subject of a different picture is somewhere else.
    expect({ ...PERSONALIZATION_DEFAULTS, ...showBackground(shelf[0]) }.chatBgFocusY).toBe(0.5);
  });

  it("reads a wallpaper shelved before it existed as the middle", () => {
    // The shelf shipped before the focus point did, so these entries are real
    // and must not resolve to `undefined` - which CSS would drop entirely.
    const legacy = { ...still("image-a.jpg") } as Entry;
    delete legacy.focusX;
    delete legacy.focusY;

    const record = { ...PERSONALIZATION_DEFAULTS, ...showBackground(legacy) };
    expect(record.chatBgFocusX).toBe(0.5);
    expect(record.chatBgFocusY).toBe(0.5);
  });

  it("is not part of what makes a wallpaper itself", () => {
    // Re-framing a picture must not shelve a second copy of it.
    const framed = { ...still("image-a.jpg"), focusY: 0.1 };
    expect(isSameBackground(still("image-a.jpg"), framed)).toBe(true);
    expect(rememberBackground([still("image-a.jpg")], framed)).toHaveLength(1);
  });
});

describe("the keep-list", () => {
  it("names every file the shelf and the live fields still point at", () => {
    const record = {
      ...PERSONALIZATION_DEFAULTS,
      ...showBackground({
        ...clip("video-a.mp4", "image-p.jpg"),
        blurred: "bgstore:processed-p.jpg",
        videoBaked: "video-baked-x.mp4",
      }),
      chatBgRecents: [clip("video-a.mp4", "image-p.jpg"), still("image-b.jpg")],
    };

    expect([...referencedFiles(record)].sort()).toEqual([
      "image-b.jpg",
      "image-p.jpg",
      "processed-p.jpg",
      "video-a.mp4",
      "video-baked-x.mp4",
    ]);
  });

  it("keeps the wallpaper on screen even when the shelf has forgotten it", () => {
    // Standard's editor writes the live fields and knows nothing about the
    // shelf; a prune must not delete the picture that is being displayed.
    const record = { ...PERSONALIZATION_DEFAULTS, chatBgOriginal: "bgstore:image-legacy.jpg" };
    expect(referencedFiles(record)).toEqual(["image-legacy.jpg"]);
  });

  it("names no file for a data-URL wallpaper", () => {
    const record = { ...PERSONALIZATION_DEFAULTS, chatBgOriginal: "data:image/jpeg;base64,x" };
    expect(referencedFiles(record)).toEqual([]);
  });
});
