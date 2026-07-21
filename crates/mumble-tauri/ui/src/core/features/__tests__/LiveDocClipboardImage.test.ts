/**
 * Regression tests for the live-doc clipboard image helper.
 *
 * Pasting an image while the live doc is focused must insert into the
 * editor (not be hijacked by the chat composer).  The editor identifies
 * the pasted image via `imageFileFromClipboard`, which reads the
 * DataTransfer's items first (the WebKit/Chromium path) and falls back
 * to its files list.
 */

import { describe, expect, it } from "vitest";
import { imageFileFromClipboard } from "../chat/livedoc/liveDocImageInsert";

function file(name: string, type: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

function dataTransfer(opts: {
  items?: { kind: string; type: string; file: File | null }[];
  files?: File[];
}): DataTransfer {
  const items = (opts.items ?? []).map((it) => ({
    kind: it.kind,
    type: it.type,
    getAsFile: () => it.file,
  }));
  return {
    items: items as unknown as DataTransferItemList,
    files: (opts.files ?? []) as unknown as FileList,
  } as DataTransfer;
}

describe("imageFileFromClipboard", () => {
  it("returns null for empty / missing data", () => {
    expect(imageFileFromClipboard(null)).toBeNull();
    expect(imageFileFromClipboard(undefined)).toBeNull();
    expect(imageFileFromClipboard(dataTransfer({}))).toBeNull();
  });

  it("returns an image file found in items", () => {
    const img = file("p.png", "image/png");
    const result = imageFileFromClipboard(
      dataTransfer({ items: [{ kind: "file", type: "image/png", file: img }] }),
    );
    expect(result).toBe(img);
  });

  it("ignores non-image and non-file items", () => {
    const result = imageFileFromClipboard(
      dataTransfer({
        items: [
          { kind: "string", type: "text/plain", file: null },
          { kind: "file", type: "application/pdf", file: file("d.pdf", "application/pdf") },
        ],
      }),
    );
    expect(result).toBeNull();
  });

  it("falls back to the files list when items has no image", () => {
    const img = file("q.jpg", "image/jpeg");
    const result = imageFileFromClipboard(dataTransfer({ files: [img] }));
    expect(result).toBe(img);
  });
});
