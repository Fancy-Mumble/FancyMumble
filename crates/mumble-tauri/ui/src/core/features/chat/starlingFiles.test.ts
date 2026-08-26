import { describe, it, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...(a as [])) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => undefined) }));

const { decodeFileAttachmentPayload, encodeFileAttachmentMarker } = await import("./fileAttachments");
const { canonFileServerConfig, isCanonAttachment, mimeForFilename } = await import("./starlingFiles");
const { uploadAttachment } = await import("./useFileUpload");
const { useAppStore } = await import("../../store");

beforeEach(() => {
  invoke.mockReset();
});

describe("the attachment marker", () => {
  it("carries a key when there is no lasting URL to carry", () => {
    // The URL a canon server signs is good for about a minute, so a message
    // carrying one would have a dead link in it by the time anybody scrolled
    // back to it. The key is what lasts.
    const marker = encodeFileAttachmentMarker({
      url: "",
      key: "3/018f/sunset.png",
      filename: "sunset.png",
      sizeBytes: 4096,
      mode: "session",
    });
    const decoded = decodeFileAttachmentPayload(/FANCY_FILE:([A-Za-z0-9+/=]+)/.exec(marker)![1]);
    expect(decoded?.key).toBe("3/018f/sunset.png");
    expect(isCanonAttachment(decoded!)).toBe(true);
  });

  it("still reads a plugin marker, which has a URL and no key", () => {
    const marker = encodeFileAttachmentMarker({
      url: "https://files.example/files/abc",
      filename: "notes.pdf",
      mode: "public",
    });
    const decoded = decodeFileAttachmentPayload(/FANCY_FILE:([A-Za-z0-9+/=]+)/.exec(marker)![1]);
    expect(decoded?.url).toBe("https://files.example/files/abc");
    expect(isCanonAttachment(decoded!)).toBe(false);
  });

  it("refuses a marker that names no file at all", () => {
    // Neither a link nor a key: a card for one would be a download button
    // that cannot be pressed.
    const payload = btoa(JSON.stringify({ url: "", filename: "ghost.bin", mode: "session" }));
    expect(decodeFileAttachmentPayload(payload)).toBeNull();
  });
});

describe("uploading", () => {
  it("asks the canon service when that is what the server speaks", async () => {
    useAppStore.setState({ fileServerKind: "canon" });
    invoke.mockResolvedValue({ key: "3/018f/clip.mp4", size: 900 });

    const info = await uploadAttachment({
      filePath: "/home/me/clip.mp4",
      channelId: 3,
      filename: "clip.mp4",
      uploadId: "u1",
      choice: { mode: "public" },
    });

    expect(invoke).toHaveBeenCalledWith("starling_upload_file", {
      filePath: "/home/me/clip.mp4",
      channelId: 3,
      mimeType: "video/mp4",
      uploadId: "u1",
    });
    expect(info).toEqual({
      url: "",
      key: "3/018f/clip.mp4",
      filename: "clip.mp4",
      sizeBytes: 900,
      // Asked for public, shared as session: the canon has no field for
      // visibility, so promising a public link would be promising something
      // the server was never told about.
      mode: "session",
    });
  });

  it("goes through the plugin when the server has one", async () => {
    const uploadFile = vi.fn(async () => ({
      download_url: "https://files.example/files/abc",
      size_bytes: 12,
      access_mode: "public" as const,
      expires_at: null,
    }));
    useAppStore.setState({ fileServerKind: "plugin", uploadFile } as never);

    const info = await uploadAttachment({
      filePath: "/home/me/note.txt",
      channelId: 3,
      filename: "note.txt",
      uploadId: "u2",
      choice: { mode: "public", ttlSeconds: 60 },
    });

    expect(invoke).not.toHaveBeenCalled();
    expect(uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "public", ttlSeconds: 60, uploadId: "u2" }),
    );
    expect(info.url).toBe("https://files.example/files/abc");
    expect(info.key).toBeUndefined();
  });
});

describe("what a canon server is said to allow", () => {
  it("unlocks sharing but not public links", () => {
    // `UploadRequest` carries no visibility, so a public-link option would be
    // an option the server has no way to honour.
    const config = canonFileServerConfig(7);
    expect(config.canShareFiles).toBe(true);
    expect(config.canShareFilesPublic).toBe(false);
    expect(config.sessionId).toBe(7);
    expect(config.baseUrl).toBe("");
  });
});

describe("guessing what a file is", () => {
  it("names the media types a preview depends on", () => {
    expect(mimeForFilename("sunset.PNG")).toBe("image/png");
    expect(mimeForFilename("talk.opus")).toBe("audio/ogg");
    expect(mimeForFilename("clip.mov")).toBe("video/quicktime");
  });

  it("falls back rather than guessing wrong", () => {
    expect(mimeForFilename("archive.tar.zst")).toBe("application/octet-stream");
    expect(mimeForFilename("Makefile")).toBe("application/octet-stream");
  });
});
