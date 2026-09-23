import { describe, it, expect } from "vitest";
import { extractMedia } from "./MediaPreview";

const PNG = "data:image/png;base64,iVBORw0KGgo=";

describe("extractMedia and remote media", () => {
  it("tiles an inline picture", () => {
    const { media } = extractMedia(`<img src="${PNG}" alt="shot">`);

    expect(media).toHaveLength(1);
    expect(media[0]?.src).toBe(PNG);
  });

  it("never tiles a remote picture, and leaves a link to it instead", () => {
    const { cleaned, media } = extractMedia('<img src="https://t.example/p.gif" alt="GIF">');

    expect(media).toEqual([]);
    const link = new DOMParser().parseFromString(cleaned, "text/html").querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://t.example/p.gif");
    expect(link?.dataset["external"]).toBe("true");
  });

  it("never tiles a remote clip", () => {
    const { media } = extractMedia('<video src="https://t.example/clip.mp4"></video>');

    expect(media).toEqual([]);
  });

  it("drops an inline style that would fetch", () => {
    const { cleaned } = extractMedia('<span style="background: url(https://t.example/a.png)">x</span>');

    expect(cleaned).not.toContain("t.example");
  });
});
