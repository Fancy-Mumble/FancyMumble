import { describe, expect, it } from "vitest";
import {
  CONTRAST_ACCENT,
  clampHex,
  contrast,
  diffLivery,
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
      expect(contrast(clampHex(accent, "#f6f4f0"), "#f6f4f0")).toBeGreaterThanOrEqual(
        CONTRAST_ACCENT,
      );
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
