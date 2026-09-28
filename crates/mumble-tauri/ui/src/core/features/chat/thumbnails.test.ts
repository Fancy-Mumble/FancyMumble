/**
 * Thumbnails: what a marker carries, what a card draws, and what the lightbox
 * insists on drawing instead.
 *
 * The one rule underneath all of it: a *preview* may be a stand-in, and the
 * pop-out may never be. Everything here is a way of pinning one half of that
 * down.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn();
const convertFileSrc = vi.fn((path: string) => `asset://localhost/${path}`);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...a: unknown[]) => invoke(...(a as [])),
  convertFileSrc: (path: string) => convertFileSrc(path),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => undefined) }));

const { attachmentAspectRatio, decodeFileAttachmentPayload, encodeFileAttachmentMarker } =
  await import("./fileAttachments");
const { previewKeyFor, useCanonPreviewSrc } = await import("./starlingFiles");
const { findPopOutImageSrc, hasPopOutImage, resolvePopOutImage } = await import("./imagePopout");
const { isHeavyContent } = await import("../../messageOffload");

beforeEach(() => {
  invoke.mockReset();
  convertFileSrc.mockClear();
});

/** Read a marker back the way a message row does. */
function roundTrip(info: Parameters<typeof encodeFileAttachmentMarker>[0]) {
  const marker = encodeFileAttachmentMarker(info);
  return decodeFileAttachmentPayload(/FANCY_FILE:([A-Za-z0-9+/=]+)/.exec(marker)![1]);
}

describe("what the marker says about a picture", () => {
  it("carries the thumbnail's key and the full picture's shape", () => {
    const decoded = roundTrip({
      url: "",
      key: "7/018f/sunset.png",
      thumbKey: "7/018f/sunset.png.thumb",
      filename: "sunset.png",
      sizeBytes: 4_200_000,
      width: 4032,
      height: 3024,
      mode: "session",
    });
    expect(decoded?.thumbKey).toBe("7/018f/sunset.png.thumb");
    expect(decoded?.width).toBe(4032);
    expect(decoded?.height).toBe(3024);
  });

  it("still reads a marker written before thumbnails existed", () => {
    const decoded = roundTrip({ url: "", key: "7/old.png", filename: "old.png", mode: "session" });
    expect(decoded?.thumbKey).toBeUndefined();
    expect(decoded?.width).toBeUndefined();
    expect(attachmentAspectRatio(decoded!)).toBeUndefined();
  });

  it("refuses a size no picture has, because a row is laid out from it", () => {
    // The numbers are the sender's, not this client's. A zero collapses the
    // row and a made-up one opens a mile of blank column, so neither is
    // believed and the row goes back to guessing.
    const decoded = decodeFileAttachmentPayload(
      btoa(
        JSON.stringify({
          url: "",
          key: "7/liar.png",
          filename: "liar.png",
          mode: "session",
          width: 0,
          height: 9_000_000,
        }),
      ),
    );
    expect(decoded?.width).toBeUndefined();
    expect(decoded?.height).toBeUndefined();
  });

  it("hands a row the box to hold open", () => {
    const decoded = roundTrip({
      url: "",
      key: "7/wide.jpg",
      filename: "wide.jpg",
      width: 1600,
      height: 900,
      mode: "session",
    });
    expect(attachmentAspectRatio(decoded!)).toBe("1600 / 900");
  });
});

describe("what a card draws", () => {
  it("prefers the thumbnail to the picture it stands for", () => {
    expect(
      previewKeyFor({
        url: "",
        key: "7/big.png",
        thumbKey: "7/big.png.thumb",
        filename: "big.png",
        mode: "session",
      }),
    ).toBe("7/big.png.thumb");
  });

  it("falls back to the object itself when nothing made a thumbnail", () => {
    expect(previewKeyFor({ url: "", key: "7/big.png", filename: "big.png", mode: "session" })).toBe(
      "7/big.png",
    );
  });

  it("does not stand a film in for itself", () => {
    // A thumbnail of a video would be a poster frame, which is a different
    // thing nothing produces yet - and a player pointed at one plays a still.
    expect(
      previewKeyFor({
        url: "",
        key: "7/film.mp4",
        thumbKey: "7/film.mp4.thumb",
        filename: "film.mp4",
        mode: "session",
      }),
    ).toBe("7/film.mp4");
  });

  it("shows a huge picture after all, once there is a thumbnail of it", async () => {
    // Past the cap the card used to give up and offer a Save button. The cap
    // is about the eighty megabytes a preview would spend, and a thumbnail
    // spends twenty-four kilobytes, so it is no longer the question.
    const { renderHook, waitFor } = await import("@testing-library/react");
    const THUMB = "http://127.0.0.1:41234/tok/7%2Fscan.png.thumb";
    invoke.mockResolvedValue(THUMB);
    const { result } = renderHook(() =>
      useCanonPreviewSrc({
        url: "",
        key: "7/scan.png",
        thumbKey: "7/scan.png.thumb",
        filename: "scan.png",
        sizeBytes: 80 * 1024 * 1024,
        mode: "session",
      }),
    );

    await waitFor(() => expect(result.current).toBe(THUMB));
    expect(invoke).toHaveBeenCalledWith("starling_media_url", { key: "7/scan.png.thumb" });
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});

describe("what the pop-out draws", () => {
  it("opens a session share, which it could not show at all before", async () => {
    const FULL = "http://127.0.0.1:41234/tok/7%2Fscan.png";
    invoke.mockResolvedValue(FULL);
    const body = `${encodeFileAttachmentMarker({
      url: "",
      key: "7/scan.png",
      filename: "scan.png",
      mode: "session",
    })}`;
    expect(findPopOutImageSrc(body)).toBeNull();
    expect(await resolvePopOutImage(body)).toEqual({ src: FULL });
  });

  it("asks for the full object even when a thumbnail is at hand", async () => {
    // The whole purpose of the window is the picture at its own size. A
    // 320 px stand-in blown up to full screen is the one place the thumbnail
    // must not reach.
    const FULL = "http://127.0.0.1:41234/tok/7%2Fscan.png";
    invoke.mockResolvedValue(FULL);
    const body = encodeFileAttachmentMarker({
      url: "",
      key: "7/scan.png",
      thumbKey: "7/scan.png.thumb",
      filename: "scan.png",
      mode: "session",
    });
    await resolvePopOutImage(body);
    expect(invoke).toHaveBeenCalledWith("starling_media_url", { key: "7/scan.png" });
  });

  it("says a sealed share needs its password rather than opening noise", async () => {
    // The signed route hands back ciphertext for a password share: the server
    // cannot open its own object, which is the point of the mode.
    const body = encodeFileAttachmentMarker({
      url: "https://files.example/s/abc",
      key: "7/secret.png",
      filename: "secret.png",
      mode: "password",
    });
    expect(await resolvePopOutImage(body)).toEqual({ failure: "needs-password" });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("brings a sealed share down once the password is supplied", async () => {
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "write_attachment_bytes") return Promise.resolve("/tmp/attachment-1.png");
      if (cmd === "starling_download_to_file") return Promise.resolve(12_345);
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });
    const body = encodeFileAttachmentMarker({
      url: "https://files.example/s/abc",
      key: "7/secret.png",
      filename: "secret.png",
      mode: "password",
    });
    expect(await resolvePopOutImage(body, "hunter2")).toEqual({
      src: "asset://localhost//tmp/attachment-1.png",
    });
    expect(invoke).toHaveBeenCalledWith("starling_download_to_file", {
      key: "7/secret.png",
      destPath: "/tmp/attachment-1.png",
      share: { url: "https://files.example/s/abc", password: "hunter2" },
    });
  });

  it("sends the caller round again when the password was wrong", async () => {
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "write_attachment_bytes") return Promise.resolve("/tmp/attachment-1.png");
      return Promise.reject(new Error("wrong password"));
    });
    const body = encodeFileAttachmentMarker({
      url: "https://files.example/s/abc",
      key: "7/secret.png",
      filename: "secret.png",
      mode: "password",
    });
    expect(await resolvePopOutImage(body, "nope")).toEqual({ failure: "needs-password" });
  });

  it("spends nothing on a public link, which is already an address", async () => {
    const body = encodeFileAttachmentMarker({
      url: "https://files.example/files/abc.png",
      filename: "abc.png",
      mode: "public",
    });
    expect(await resolvePopOutImage(body)).toEqual({ src: "https://files.example/files/abc.png" });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("offers the item for an attachment no synchronous answer covers", () => {
    const body = encodeFileAttachmentMarker({
      url: "",
      key: "7/scan.png",
      filename: "scan.png",
      mode: "session",
    });
    expect(hasPopOutImage(body)).toBe(true);
    expect(hasPopOutImage("just words")).toBe(false);
  });

  it("has nothing to open for a file that is not a picture", async () => {
    const body = encodeFileAttachmentMarker({
      url: "",
      key: "7/notes.pdf",
      filename: "notes.pdf",
      mode: "session",
    });
    expect(hasPopOutImage(body)).toBe(false);
    expect(await resolvePopOutImage(body)).toEqual({ failure: "unavailable" });
  });
});

describe("what the offload store leaves alone", () => {
  /** A body carrying an inline picture of `bytes` base64 characters. */
  const inlineImage = (bytes: number) => `look <img src="data:image/png;base64,${"A".repeat(bytes)}">`;

  it("never puts away a thumbnail, which costs more to fetch back than to hold", () => {
    expect(isHeavyContent(inlineImage(24 * 1024))).toBe(false);
  });

  it("still puts away a pasted screenshot", () => {
    expect(isHeavyContent(inlineImage(200_000))).toBe(true);
  });
});
