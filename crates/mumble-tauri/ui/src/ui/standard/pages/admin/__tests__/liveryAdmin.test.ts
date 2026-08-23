import { describe, expect, it } from "vitest";
import { diffLivery, isHexColour, type LiveryDocument } from "../liveryAdmin";

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
