import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONTRAST_ACCENT,
  IMAGE_BOUNDS,
  LIMITS,
  clampHex,
  contrast,
  diffLivery,
  fitLiveryImage,
  fromSnapshot,
  isHexColour,
  type LiveryDocument,
  type LiverySnapshot,
} from "../liveryAdmin";

const SAVED: LiveryDocument = {
  version: 3,
  digest: "abc",
  display_name: "magical.rocks",
  tagline: "cozy corner",
  tags: [{ label: "Rules", tone: "ACCENT" }],
  dark: { accent: "#8a90ff" },
};

describe("isHexColour", () => {
  it("accepts exactly six hex digits", () => {
    expect(isHexColour("#8a90ff")).toBe(true);
    expect(isHexColour("#8A90FF")).toBe(true);
    expect(isHexColour("  #8a90ff  ")).toBe(true);
  });

  it("rejects everything the server would reject", () => {
    // The editor must not offer a value the API will refuse, and must never
    // let one through that could carry a second declaration.
    for (const bad of ["#fff", "8a90ff", "#8a90f", "red", "red;background:url(x)", ""]) {
      expect(isHexColour(bad)).toBe(false);
    }
  });
});

describe("diffLivery", () => {
  it("sends nothing when nothing changed", () => {
    // An empty patch is refused by the server, so the Save button has to know.
    expect(diffLivery(SAVED, SAVED)).toEqual({});
  });

  it("sends only the field that changed", () => {
    const patch = diffLivery(SAVED, { ...SAVED, tagline: "somewhere else" });
    expect(patch).toEqual({ tagline: "somewhere else" });
  });

  it("sends an empty string to clear a field rather than omitting it", () => {
    // Omitting it would leave the old value in place: the API merges, so
    // "cleared" has to be stated.
    const patch = diffLivery(SAVED, { ...SAVED, tagline: undefined });
    expect(patch).toEqual({ tagline: "" });
  });

  it("notices a change nested inside a palette", () => {
    const patch = diffLivery(SAVED, { ...SAVED, dark: { accent: "#41b4f9" } });
    expect(patch).toEqual({ dark: { accent: "#41b4f9" } });
  });

  it("notices a palette entry being removed", () => {
    const patch = diffLivery(SAVED, { ...SAVED, dark: {} });
    expect(patch).toEqual({ dark: {} });
  });

  it("notices a reordered tag list", () => {
    const reordered = diffLivery(SAVED, {
      ...SAVED,
      tags: [
        { label: "Rules", tone: "ACCENT" },
        { label: "18+", tone: "WARN" },
      ],
    });
    expect(reordered.tags).toHaveLength(2);
  });

  it("never sends the fields the server owns", () => {
    // `version` and `digest` are refused as input, so a document fetched and
    // written back must not carry them.
    const patch = diffLivery(SAVED, { ...SAVED, version: 99, digest: "zzz", motd: "hi" });
    expect(patch).toEqual({ motd: "hi" });
    expect(patch).not.toHaveProperty("version");
    expect(patch).not.toHaveProperty("digest");
  });

  it("treats absent and empty as the same for an unset field", () => {
    const blank: LiveryDocument = { version: 0, digest: "" };
    expect(diffLivery(blank, { ...blank, motd: "" })).toEqual({});
    expect(diffLivery(blank, { ...blank, banner_focus_x: 0 })).toEqual({});
  });
});

describe("clampHex", () => {
  it("leaves a colour that already reads alone", () => {
    expect(clampHex("#41b4f9", "#141d33")).toBe("#41b4f9");
  });

  it("will not let a server hide its own button", () => {
    const result = clampHex("#0b0f1a", "#141d33");
    expect(result).not.toBe("#0b0f1a");
    expect(contrast(result, "#141d33")).toBeGreaterThanOrEqual(CONTRAST_ACCENT);
  });

  it("holds on a light surface too", () => {
    for (const accent of ["#fffef8", "#f5f3ee", "#ffffff"]) {
      expect(contrast(clampHex(accent, "#f6f4f0"), "#f6f4f0")).toBeGreaterThanOrEqual(CONTRAST_ACCENT);
    }
  });

  it("passes anything that is not a colour straight through", () => {
    // The editor shows what the operator typed while they are typing it; the
    // refusal comes from the server, not from a silent substitution here.
    expect(clampHex("#ab", "#141d33")).toBe("#ab");
  });
});

describe("fromSnapshot", () => {
  it("reads an empty document when the server shows nothing", () => {
    expect(fromSnapshot(null)).toEqual({ version: 0, digest: "" });
  });

  it("maps every field the editor writes", () => {
    // The two shapes exist because they answer different questions; a field
    // missed here is one the editor silently cannot edit.
    const snapshot: LiverySnapshot = {
      version: 4,
      digest: "abcd",
      displayName: "magical.rocks",
      tagline: "cozy",
      motd: "movie night",
      tags: [{ label: "Rules", tone: "ACCENT" }],
      rulesUrl: "https://x/rules",
      bannerKey: "aa",
      iconKey: "bb",
      bannerSrc: "data:image/png;base64,AA",
      bannerFocus: { x: 40, y: 35 },
      palette: { dark: { accent: "#8a90ff" } },
    };
    const document = fromSnapshot(snapshot);
    expect(document.display_name).toBe("magical.rocks");
    expect(document.tagline).toBe("cozy");
    expect(document.motd).toBe("movie night");
    expect(document.rules_url).toBe("https://x/rules");
    expect(document.banner_key).toBe("aa");
    expect(document.icon_key).toBe("bb");
    expect(document.banner_focus_x).toBe(40);
    expect(document.banner_focus_y).toBe(35);
    expect(document.tags).toEqual([{ label: "Rules", tone: "ACCENT" }]);
    expect(document.dark).toEqual({ accent: "#8a90ff" });
  });

  it("round-trips through the diff without inventing a change", () => {
    // A page that loads a snapshot and immediately reports itself dirty would
    // send a patch nobody asked for.
    const snapshot: LiverySnapshot = {
      version: 4,
      digest: "abcd",
      tagline: "cozy",
      tags: [],
      palette: { dark: { accent: "#8a90ff" } },
    };
    const document = fromSnapshot(snapshot);
    expect(diffLivery(document, document)).toEqual({});
  });
});

/**
 * A stand-in for the webview's decoder and encoder.
 *
 * jsdom has neither, and the real ones would make the test about WebP's
 * compression rather than about the ladder. `weight` models the one property
 * the ladder actually depends on: bytes fall with area and with quality.
 */
function stubCodec(source: { width: number; height: number }, weight: number) {
  const encoded: { width: number; height: number; quality: number }[] = [];
  vi.stubGlobal("createImageBitmap", () => Promise.resolve({ ...source, close: () => undefined }));
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      constructor(
        readonly width: number,
        readonly height: number,
      ) {}
      getContext() {
        return { drawImage: () => undefined };
      }
      convertToBlob({ quality }: { quality: number }) {
        encoded.push({ width: this.width, height: this.height, quality });
        const size = Math.round(this.width * this.height * quality * weight);
        // Sized, not filled: the real encoder's output is megabytes at the top
        // of the ladder, and the fitter is supposed to weigh an attempt without
        // reading it.
        const blob = {
          size,
          type: "image/webp",
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(size)),
        };
        return Promise.resolve(blob as unknown as Blob);
      }
    },
  );
  return encoded;
}

describe("fitLiveryImage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("hands back artwork that already fits, byte for byte", async () => {
    // An operator who prepared a banner gets the encoding they prepared: a
    // re-compression of it would throw away a deliberate choice to save
    // nothing.
    stubCodec({ width: 1200, height: 400 }, 1);
    const original = new Uint8Array(40_000).fill(7);
    const fitted = await fitLiveryImage(new Blob([original], { type: "image/png" }), "banner");

    expect(fitted.resized).toBe(false);
    expect(fitted.bytes).toStrictEqual(original);
    expect([fitted.width, fitted.height]).toEqual([1200, 400]);
  });

  it("scales a camera-sized picture into the box the banner is painted in", async () => {
    // The case that produced "Failed to buffer the request body": 4032x3024
    // off a phone is refused by the transport before the API can say a word
    // about artwork.
    const encoded = stubCodec({ width: 4032, height: 3024 }, 0.02);
    const fitted = await fitLiveryImage(
      new Blob([new Uint8Array(6 * 1024 * 1024)], { type: "image/jpeg" }),
      "banner",
    );

    expect(fitted.resized).toBe(true);
    expect(fitted.bytes.length).toBeLessThanOrEqual(LIMITS.bannerBytes);
    expect(fitted.width).toBeLessThanOrEqual(IMAGE_BOUNDS.banner.width);
    expect(fitted.height).toBeLessThanOrEqual(IMAGE_BOUNDS.banner.height);
    // Aspect ratio is the picture's, not the box's - the connect screen crops
    // with `object-fit`, and stretching here would bake the distortion in.
    expect(fitted.width / fitted.height).toBeCloseTo(4032 / 3024, 2);
    // The first encode is tried at the largest size that fits the box.
    expect(encoded[0].quality).toBe(0.92);
  });

  it("drops quality before it drops pixels, and pixels only when it must", async () => {
    // A picture that fits the box but not the cap: the ladder walks quality
    // down at full size first, because a smaller image is the more visible
    // loss.
    const encoded = stubCodec({ width: 256, height: 256 }, 4);
    const fitted = await fitLiveryImage(
      new Blob([new Uint8Array(900_000), new Uint8Array(0)], { type: "image/png" }),
      "icon",
    );

    expect(fitted.bytes.length).toBeLessThanOrEqual(LIMITS.iconBytes);
    const sizes = encoded.map((step) => step.width);
    expect(sizes[0]).toBe(256);
    expect(sizes.at(-1)).toBeLessThan(256);
    expect(fitted.width).toBe(sizes.at(-1));
  });

  it("stops shrinking rather than uploading a thumbnail", async () => {
    // Nothing can make this fit. Sending the smallest attempt leaves the
    // refusal to the server, which names the real number - and a 16-pixel
    // banner nobody asked for would be the worse answer.
    stubCodec({ width: 4000, height: 1000 }, 1000);
    const fitted = await fitLiveryImage(
      new Blob([new Uint8Array(9_000_000)], { type: "image/jpeg" }),
      "banner",
    );

    expect(fitted.resized).toBe(true);
    expect(Math.max(fitted.width, fitted.height)).toBeGreaterThan(48);
  });

  it("sends the original when the webview cannot decode it at all", async () => {
    // Not being able to fit an image is not a reason to refuse to upload one.
    vi.stubGlobal("createImageBitmap", () => Promise.reject(new Error("no decoder")));
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        getContext() {
          return null;
        }
      },
    );
    const original = new Uint8Array(3_000_000).fill(9);
    const fitted = await fitLiveryImage(new Blob([original], { type: "image/jpeg" }), "banner");

    expect(fitted.resized).toBe(false);
    expect(fitted.bytes.length).toBe(original.length);
    expect([fitted.width, fitted.height]).toEqual([0, 0]);
  });
});
