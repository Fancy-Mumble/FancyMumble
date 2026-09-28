import { describe, it, expect, beforeEach } from "vitest";
import { forgetImageSizes, imageSizeFromSource, rememberImageSize, sizeFromBytes } from "../imageSize";

/** A `data:` URL over raw bytes, the way a message body carries a picture. */
function dataUrl(mime: string, bytes: number[]): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `data:${mime};base64,${btoa(bin)}`;
}

const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const le16 = (n: number) => [n & 0xff, (n >>> 8) & 0xff];
const le32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

function png(width: number, height: number): number[] {
  return [
    0x89,
    ...ascii("PNG"),
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...be32(13),
    ...ascii("IHDR"),
    ...be32(width),
    ...be32(height),
    8,
    6,
    0,
    0,
    0,
  ];
}

function gif(width: number, height: number): number[] {
  return [...ascii("GIF89a"), ...le16(width), ...le16(height), 0xf7, 0, 0];
}

/** A JPEG with `padding` bytes of EXIF-ish junk before its frame header. */
function jpeg(width: number, height: number, padding = 0, sof = 0xc0): number[] {
  const junk = padding > 0 ? [0xff, 0xe1, ...le16(0), ...new Array(padding).fill(0x20)] : [];
  if (junk.length > 0) {
    // Fix the segment length up: it counts itself.
    const length = padding + 2;
    junk[2] = (length >>> 8) & 0xff;
    junk[3] = length & 0xff;
  }
  return [
    0xff,
    0xd8,
    ...junk,
    0xff,
    sof,
    0x00,
    0x11,
    8,
    (height >>> 8) & 0xff,
    height & 0xff,
    (width >>> 8) & 0xff,
    width & 0xff,
    3,
    ...new Array(9).fill(0),
  ];
}

function webpLossy(width: number, height: number): number[] {
  return [
    ...ascii("RIFF"),
    ...le32(0),
    ...ascii("WEBP"),
    ...ascii("VP8 "),
    ...le32(0),
    0x30,
    0x00,
    0x00, // frame tag
    0x9d,
    0x01,
    0x2a, // start code
    ...le16(width),
    ...le16(height),
    ...new Array(8).fill(0),
  ];
}

function webpLossless(width: number, height: number): number[] {
  const bits = (width - 1) | ((height - 1) << 14);
  return [
    ...ascii("RIFF"),
    ...le32(0),
    ...ascii("WEBP"),
    ...ascii("VP8L"),
    ...le32(0),
    0x2f,
    ...le32(bits >>> 0),
    ...new Array(12).fill(0),
  ];
}

function webpExtended(width: number, height: number): number[] {
  const w = width - 1;
  const h = height - 1;
  return [
    ...ascii("RIFF"),
    ...le32(0),
    ...ascii("WEBP"),
    ...ascii("VP8X"),
    ...le32(10),
    0x10,
    0,
    0,
    0, // flags + reserved
    w & 0xff,
    (w >>> 8) & 0xff,
    (w >>> 16) & 0xff,
    h & 0xff,
    (h >>> 8) & 0xff,
    (h >>> 16) & 0xff,
    ...new Array(8).fill(0),
  ];
}

function bmp(width: number, height: number): number[] {
  return [
    ...ascii("BM"),
    ...new Array(16).fill(0),
    ...le32(width >>> 0),
    ...le32(height >>> 0),
    ...new Array(8).fill(0),
  ];
}

/** An AVIF-ish container: a thumbnail's `ispe` first, the picture's second. */
function avif(width: number, height: number): number[] {
  const ispe = (w: number, h: number) => [...be32(20), ...ascii("ispe"), ...be32(0), ...be32(w), ...be32(h)];
  return [
    ...be32(20),
    ...ascii("ftyp"),
    ...ascii("avif"),
    ...new Array(8).fill(0),
    ...ispe(240, 180),
    ...ispe(width, height),
  ];
}

describe("imageSizeFromSource", () => {
  beforeEach(() => forgetImageSizes());

  it("reads a PNG's IHDR", () => {
    expect(imageSizeFromSource(dataUrl("image/png", png(1920, 1080)))).toEqual({
      width: 1920,
      height: 1080,
    });
  });

  it("reads a GIF's logical screen", () => {
    expect(imageSizeFromSource(dataUrl("image/gif", gif(498, 280)))).toEqual({ width: 498, height: 280 });
  });

  it("reads a JPEG's frame header", () => {
    expect(imageSizeFromSource(dataUrl("image/jpeg", jpeg(4032, 3024)))).toEqual({
      width: 4032,
      height: 3024,
    });
  });

  it("walks past a phone's EXIF block to the frame header", () => {
    expect(imageSizeFromSource(dataUrl("image/jpeg", jpeg(800, 600, 30_000)))).toEqual({
      width: 800,
      height: 600,
    });
  });

  it("reads a progressive JPEG (SOF2) as well as a baseline one", () => {
    expect(imageSizeFromSource(dataUrl("image/jpeg", jpeg(640, 480, 0, 0xc2)))).toEqual({
      width: 640,
      height: 480,
    });
  });

  it("is not fooled by a Huffman table marker sharing the SOF range", () => {
    // 0xC4 is DHT, not a frame: parsing it as one would read table bytes as
    // dimensions and reserve a box of nonsense.
    const bytes = [0xff, 0xd8, 0xff, 0xc4, 0x00, 0x08, 1, 2, 3, 4, 5, 6, ...jpeg(320, 240).slice(2)];
    expect(imageSizeFromSource(dataUrl("image/jpeg", bytes))).toEqual({ width: 320, height: 240 });
  });

  it("reads all three WebP flavours", () => {
    const url = "image/webp";
    expect(imageSizeFromSource(dataUrl(url, webpLossy(1280, 720)))).toEqual({ width: 1280, height: 720 });
    expect(imageSizeFromSource(dataUrl(url, webpLossless(300, 200)))).toEqual({ width: 300, height: 200 });
    expect(imageSizeFromSource(dataUrl(url, webpExtended(4096, 2160)))).toEqual({
      width: 4096,
      height: 2160,
    });
  });

  it("reads a BMP, top-down rows included", () => {
    expect(imageSizeFromSource(dataUrl("image/bmp", bmp(64, 64)))).toEqual({ width: 64, height: 64 });
    expect(imageSizeFromSource(dataUrl("image/bmp", bmp(64, -32 >>> 0)))).toEqual({
      width: 64,
      height: 32,
    });
  });

  it("takes the largest `ispe` in an AVIF, not the thumbnail's", () => {
    expect(imageSizeFromSource(dataUrl("image/avif", avif(3000, 2000)))).toEqual({
      width: 3000,
      height: 2000,
    });
  });

  it("reads an SVG's own width and height", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90"><rect/></svg>';
    expect(imageSizeFromSource(`data:image/svg+xml,${encodeURIComponent(svg)}`)).toEqual({
      width: 120,
      height: 90,
    });
    expect(imageSizeFromSource(dataUrl("image/svg+xml", ascii(svg)))).toEqual({ width: 120, height: 90 });
  });

  it("falls back to an SVG's viewBox, and ignores a relative width", () => {
    const svg = '<svg width="100%" height="100%" viewBox="0 0 800 450"></svg>';
    expect(imageSizeFromSource(`data:image/svg+xml,${encodeURIComponent(svg)}`)).toEqual({
      width: 800,
      height: 450,
    });
  });

  it("says nothing about a body it cannot read", () => {
    expect(imageSizeFromSource("")).toBeNull();
    expect(imageSizeFromSource("data:image/png;base64,")).toBeNull();
    expect(imageSizeFromSource("data:image/png;base64,!!!!not base64!!!!")).toBeNull();
    expect(imageSizeFromSource(dataUrl("image/png", [1, 2, 3, 4]))).toBeNull();
    // A header that parses to nothing is no better than no header at all.
    expect(imageSizeFromSource(dataUrl("image/gif", gif(0, 0)))).toBeNull();
  });

  it("says nothing about a remote picture until one has been measured", () => {
    const url = "https://example.test/cat.png";
    expect(imageSizeFromSource(url)).toBeNull();
    rememberImageSize(url, { width: 800, height: 450 });
    expect(imageSizeFromSource(url)).toEqual({ width: 800, height: 450 });
  });

  it("does not remember a data URL, or a picture that measured nothing", () => {
    const data = dataUrl("image/png", png(10, 10));
    rememberImageSize(data, { width: 999, height: 999 });
    expect(imageSizeFromSource(data)).toEqual({ width: 10, height: 10 });
    rememberImageSize("https://example.test/broken.png", { width: 0, height: 0 });
    expect(imageSizeFromSource("https://example.test/broken.png")).toBeNull();
  });
});

describe("sizeFromBytes", () => {
  it("sniffs the format rather than trusting a declared MIME type", () => {
    // A `.png` that is really a JPEG is a thing that happens; the bytes decide.
    expect(sizeFromBytes(Uint8Array.from(jpeg(200, 100)))).toEqual({ width: 200, height: 100 });
  });
});
