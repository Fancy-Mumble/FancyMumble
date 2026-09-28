import { describe, expect, it } from "vitest";
import { imageFileName, isRemoteImage } from "./imageActions";

describe("isRemoteImage", () => {
  it("knows an address from a picture carried in the message", () => {
    expect(isRemoteImage("https://files.example.com/7/cat.png?ticket=abc")).toBe(true);
    expect(isRemoteImage("http://localhost:8080/cat.png")).toBe(true);
    expect(isRemoteImage("data:image/png;base64,iVBORw0KGgo=")).toBe(false);
    expect(isRemoteImage("blob:tauri://localhost/9f2c")).toBe(false);
    expect(isRemoteImage("asset://localhost/C:/Users/me/cat.png")).toBe(false);
  });
});

describe("imageFileName", () => {
  it("keeps the name a sent file already had", () => {
    expect(imageFileName("https://files.example.com/7/holiday.jpg?ticket=abc", "image/jpeg")).toBe(
      "holiday.jpg",
    );
  });

  it("decodes a name that travelled percent-encoded", () => {
    expect(imageFileName("https://files.example.com/7/two%20cats.png", "image/png")).toBe("two cats.png");
  });

  it("stamps a name where the link has none to keep", () => {
    // A signed download URL ending in an opaque id is not a filename, and
    // saving as `a91f3c` would be worse than saving as nothing.
    const name = imageFileName("https://files.example.com/download/a91f3c", "image/png");
    expect(name).toMatch(/^image-[\d-]+T[\d-]+\.png$/);
  });

  it("names a pasted picture by what its bytes turned out to be", () => {
    expect(imageFileName("data:image/webp;base64,UklGRg==", "image/webp")).toMatch(/\.webp$/);
    // An unrecognised type still lands on disk as something a viewer opens.
    expect(imageFileName("data:application/octet-stream;base64,AA==", "application/octet-stream")).toMatch(
      /\.png$/,
    );
  });
});
