import { describe, expect, it, vi } from "vitest";

const invoke = vi.fn(async () => "AAAA");
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@core/utils/media", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@core/utils/media")>()),
  fitDataUrl: vi.fn(async () => "data:image/jpeg;base64,AAAA"),
}));

const { legacyImageFallbacks, stripLegacyFallback } = await import("./legacyFallback");

describe("legacy fallback", () => {
  it("is cut out of a body, leaving the marker", () => {
    const body =
      'hi\n<!-- FANCY_FILE:abc -->\n<!-- FANCY_LEGACY --><img src="data:image/jpeg;base64,AA" /><!-- /FANCY_LEGACY -->';
    expect(stripLegacyFallback(body)).toBe("hi\n<!-- FANCY_FILE:abc -->");
  });

  it("is made for pictures only", async () => {
    const blocks = await legacyImageFallbacks(
      [
        { filePath: "a.png", filename: "a.png" },
        { filePath: "b.pdf", filename: "b.pdf" },
      ],
      "<!-- FANCY_FILE:abc -->",
      131_072,
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatch(
      /^<!-- FANCY_LEGACY --><img src="data:image\/jpeg;base64,AAAA" alt="a.png" \/><!-- \/FANCY_LEGACY -->$/,
    );
    expect(stripLegacyFallback(`<!-- FANCY_FILE:abc -->\n${blocks[0]}`)).toBe("<!-- FANCY_FILE:abc -->");
  });

  it("is not cut out of a body that carries no file", () => {
    const body = "<!-- FANCY_LEGACY -->hidden<!-- /FANCY_LEGACY -->";
    expect(stripLegacyFallback(body)).toBe(body);
  });

  it("carries a long name without going over the limit", async () => {
    const [block] = await legacyImageFallbacks(
      [{ filePath: "a.png", filename: `${"&".repeat(500)}.png` }],
      "<!-- FANCY_FILE:abc -->",
      131_072,
    );
    expect(block).toBeDefined();
    expect(block!.length).toBeLessThan(131_072 - 30);
    expect(block).not.toContain("&amp;".repeat(65));
  });

  it("skips a picture too large to read again", async () => {
    const blocks = await legacyImageFallbacks(
      [{ filePath: "a.png", filename: "a.png", sizeBytes: 200 * 1024 * 1024 }],
      "<!-- FANCY_FILE:abc -->",
      131_072,
    );
    expect(blocks).toEqual([]);
  });

  it("is left out when the server's limit leaves no room for it", async () => {
    const body = "x".repeat(130_000);
    expect(await legacyImageFallbacks([{ filePath: "a.png", filename: "a.png" }], body, 131_072)).toEqual([]);
  });
});
