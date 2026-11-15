import { describe, it, expect } from "vitest";
import { extractMedia } from "./MediaPreview";
import { trustMediaBase } from "@core/utils/remoteMedia";

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

describe("extractMedia and a server's GIF proxy", () => {
  it("tiles a GIF its connected server serves, as a GIF", () => {
    trustMediaBase("https://gifs.example.org/gif?");
    const src = "https://gifs.example.org/gif?u=x&expires=1&sig=y";
    const { media } = extractMedia(`<img src="${src.replace(/&/g, "&amp;")}" alt="GIF">`);

    expect(media).toHaveLength(1);
    expect(media[0]).toMatchObject({ kind: "gif", src });
  });
});
