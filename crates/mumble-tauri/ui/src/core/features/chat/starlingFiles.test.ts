import { describe, it, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...(a as [])) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => undefined) }));

const { decodeFileAttachmentPayload, encodeFileAttachmentMarker } = await import("./fileAttachments");
const { canonFileServerConfig, canonMediaUrl, isCanonAttachment, mimeForFilename, useCanonPreviewSrc } =
  await import("./starlingFiles");
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
    invoke.mockResolvedValue({
      key: "3/018f/clip.mp4",
      size: 900,
      shareUrl: "https://files.example.org/s/3/018f/clip.mp4",
      expiresAt: 0,
    });

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
      mode: "public",
      ttlSeconds: undefined,
      password: undefined,
    });
    expect(info).toEqual({
      // Both: the link is for whoever it is handed to, and the key is how a
      // member of the channel fetches it without leaving the session.
      url: "https://files.example.org/s/3/018f/clip.mp4",
      key: "3/018f/clip.mp4",
      filename: "clip.mp4",
      sizeBytes: 900,
      mode: "public",
      expiresAt: null,
    });
  });

  it("sends the password with a password share, and only then", async () => {
    // The password is the file's encryption key on the far side, so sending
    // it for any other mode would be sending a secret nothing consumes.
    useAppStore.setState({ fileServerKind: "canon" });
    invoke.mockResolvedValue({
      key: "3/018f/tax.pdf",
      size: 12,
      shareUrl: "https://f/s/k",
      expiresAt: 0,
    });

    await uploadAttachment({
      filePath: "/home/me/tax.pdf",
      channelId: 3,
      filename: "tax.pdf",
      uploadId: "u3",
      choice: { mode: "password", password: "hunter2" },
    });
    expect(invoke).toHaveBeenCalledWith(
      "starling_upload_file",
      expect.objectContaining({ mode: "password", password: "hunter2" }),
    );

    invoke.mockClear();
    await uploadAttachment({
      filePath: "/home/me/tax.pdf",
      channelId: 3,
      filename: "tax.pdf",
      uploadId: "u4",
      choice: { mode: "session", password: "left over from the last one" },
    });
    expect(invoke).toHaveBeenCalledWith(
      "starling_upload_file",
      expect.objectContaining({ mode: "session", password: undefined }),
    );
  });

  it("sends the lifetime, and keeps the moment the server answers with", async () => {
    // The expiry the card renders is the server's, not this client's
    // arithmetic: two readers disagreeing about when a file goes is worse than
    // either of them being a second out.
    useAppStore.setState({ fileServerKind: "canon" });
    invoke.mockResolvedValue({
      key: "3/018f/note.txt",
      size: 3,
      shareUrl: "https://f/s/k",
      expiresAt: 1_800_000_000,
    });

    const info = await uploadAttachment({
      filePath: "/home/me/note.txt",
      channelId: 3,
      filename: "note.txt",
      uploadId: "u6",
      choice: { mode: "public", ttlSeconds: 604_800 },
    });
    expect(invoke).toHaveBeenCalledWith(
      "starling_upload_file",
      expect.objectContaining({ ttlSeconds: 604_800 }),
    );
    expect(info.expiresAt).toBe(1_800_000_000);
  });

  it("keeps a session share a key and nothing else", async () => {
    useAppStore.setState({ fileServerKind: "canon" });
    invoke.mockResolvedValue({ key: "3/018f/notes.txt", size: 4, shareUrl: "", expiresAt: 0 });

    const info = await uploadAttachment({
      filePath: "/home/me/notes.txt",
      channelId: 3,
      filename: "notes.txt",
      uploadId: "u5",
      choice: { mode: "session" },
    });
    expect(info.url).toBe("");
    expect(isCanonAttachment(info)).toBe(true);
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
  it("unlocks every row the tray draws", () => {
    // `UploadRequest` carries a visibility and a lifetime, so all three of the
    // composer's rows are ones the server can honour.
    const config = canonFileServerConfig(7);
    expect(config.canShareFiles).toBe(true);
    expect(config.canShareFilesPublic).toBe(true);
    expect(config.deleteOnTtl).toBe(true);
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

describe("what a canon attachment is previewed from", () => {
  const ORIGIN = "http://127.0.0.1:41234/tok/7%2F01890a%2Fclip.mp4";

  it("plays a video from an address instead of fetching its bytes", async () => {
    // The point of the origin: a player asks for the ranges it wants, so a
    // file larger than memory is playable and seeking works. Fetching first
    // would mean spending the whole video before showing a frame of it.
    const { renderHook, waitFor } = await import("@testing-library/react");
    invoke.mockResolvedValue(ORIGIN);
    const { result } = renderHook(() =>
      useCanonPreviewSrc({ url: "", key: "7/01890a/clip.mp4", filename: "clip.mp4", mode: "session" }),
    );

    await waitFor(() => expect(result.current).toBe(ORIGIN));
    expect(invoke).toHaveBeenCalledWith("starling_media_url", { key: "7/01890a/clip.mp4" });
    expect(invoke).not.toHaveBeenCalledWith("starling_download_to_base64", expect.anything());
  });

  it("streams a video however big it is", async () => {
    // The old whole-file preview capped out at 8 MiB, which is under the size
    // of essentially every video anybody shares.
    const { renderHook, waitFor } = await import("@testing-library/react");
    invoke.mockResolvedValue(ORIGIN);
    const { result } = renderHook(() =>
      useCanonPreviewSrc({
        url: "",
        key: "7/film.mp4",
        filename: "film.mp4",
        sizeBytes: 900 * 1024 * 1024,
        mode: "session",
      }),
    );

    await waitFor(() => expect(result.current).toBe(ORIGIN));
  });

  it("shows no preview rather than a broken one when the origin will not start", async () => {
    const { renderHook } = await import("@testing-library/react");
    invoke.mockRejectedValue(new Error("could not open a media port"));
    const { result } = renderHook(() =>
      useCanonPreviewSrc({ url: "", key: "7/clip.mp4", filename: "clip.mp4", mode: "session" }),
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current).toBeNull();
  });

  it("still fetches a picture whole, because that is how one is decoded", async () => {
    const { renderHook } = await import("@testing-library/react");
    invoke.mockResolvedValue("");
    renderHook(() =>
      useCanonPreviewSrc({ url: "", key: "7/cat.png", filename: "cat.png", sizeBytes: 2048, mode: "session" }),
    );

    expect(invoke).toHaveBeenCalledWith("starling_download_to_base64", { key: "7/cat.png" });
    expect(invoke).not.toHaveBeenCalledWith("starling_media_url", expect.anything());
  });

  it("leaves a plugin attachment alone - it already has a URL of its own", async () => {
    const { renderHook } = await import("@testing-library/react");
    const { result } = renderHook(() =>
      useCanonPreviewSrc({ url: "https://files.example/clip.mp4", filename: "clip.mp4", mode: "public" }),
    );

    expect(result.current).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("asks the backend for the address rather than building one", async () => {
    // The port is picked by the OS and the token is minted per run, so the
    // frontend cannot know the URL without asking.
    invoke.mockResolvedValue(ORIGIN);
    await expect(canonMediaUrl("7/01890a/clip.mp4")).resolves.toBe(ORIGIN);
  });
});
