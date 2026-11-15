import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const { invokeMock, handlers } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  handlers: new Map<string, (event: { payload: unknown }) => void>(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((name: string, handler: (event: { payload: unknown }) => void) => {
    handlers.set(name, handler);
    return Promise.resolve(() => {});
  }),
}));

const { KLIPY_DISABLED_MESSAGE, setKlipyApiKey, useKlipyEnabled } =
  await import("../features/chat/gif/klipyConfig");
const { askServerGifSupport, forgetServerGifSupport, searchServerGifs } =
  await import("../features/chat/gif/serverGifs");
const { findKlipyMedia } = await import("../features/chat/gif/klipyClient");
const { useGifsEnabled } = await import("../features/chat/gif/gifAccess");
const { isLocalMediaSrc } = await import("../utils/remoteMedia");

const BASE = "https://chat.example.org/gif?";

/** Have the server answer the next support query with `answer`. */
function serverSupports(answer: { available: boolean; media_base: string }) {
  invokeMock.mockImplementationOnce((command: string, args: { requestId: string }) => {
    expect(command).toBe("request_gif_support");
    queueMicrotask(() =>
      handlers.get("gif-support")?.({
        payload: { request_id: args.requestId, provider: "klipy", ...answer },
      }),
    );
    return Promise.resolve();
  });
}

/** Have the server answer the next search with `urls` as [url, preview] pairs. */
function serverFinds(urls: [string, string][]) {
  invokeMock.mockImplementationOnce((command: string, args: { requestId: string }) => {
    expect(command).toBe("request_gif_search");
    const results = urls.map(([url, preview], index) => ({
      id: String(index),
      title: "gif",
      url,
      preview,
      width: 0,
      height: 0,
      preview_width: 0,
      preview_height: 0,
      mime: "image/webp",
    }));
    queueMicrotask(() =>
      handlers.get("gif-search-page")?.({
        payload: { request_id: args.requestId, results, page: 1, has_next: false, provider: "klipy" },
      }),
    );
    return Promise.resolve();
  });
}

afterEach(() => {
  setKlipyApiKey(undefined);
  forgetServerGifSupport();
  invokeMock.mockReset();
  vi.restoreAllMocks();
});

describe("GIFs with neither a key nor a private server", () => {
  // On a server without a media proxy the answers are addresses on Klipy's
  // CDN, so even a server-side search ends with this machine asking Klipy.
  it("never asks the server to search", async () => {
    await expect(searchServerGifs("cat")).rejects.toThrow(KLIPY_DISABLED_MESSAGE);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("never reaches Klipy directly", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(findKlipyMedia("cat")).rejects.toThrow(KLIPY_DISABLED_MESSAGE);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("stays off on a server that searches but does not proxy", async () => {
    serverSupports({ available: true, media_base: "" });
    await askServerGifSupport();

    await expect(searchServerGifs("cat")).rejects.toThrow(KLIPY_DISABLED_MESSAGE);
  });

  it("stays off when the announced base is not one", async () => {
    // Trusting "https://" would be trusting the whole web.
    serverSupports({ available: true, media_base: "https://" });
    await askServerGifSupport();

    await expect(searchServerGifs("cat")).rejects.toThrow(KLIPY_DISABLED_MESSAGE);
    expect(isLocalMediaSrc("https://tracker.example/p.gif")).toBe(false);
  });
});

describe("GIFs from a server that proxies them", () => {
  it("searches, and keeps only what really is on the proxy", async () => {
    serverSupports({ available: true, media_base: BASE });
    await askServerGifSupport();
    serverFinds([
      [`${BASE}u=full`, `${BASE}u=thumb`],
      ["https://static.klipy.com/full.webp", `${BASE}u=thumb2`],
    ]);

    const page = await searchServerGifs("cat");

    expect(page.items.map((gif) => gif.url)).toEqual([`${BASE}u=full`]);
  });

  it("lets its GIFs render in messages", async () => {
    serverSupports({ available: true, media_base: BASE });
    await askServerGifSupport();

    expect(isLocalMediaSrc(`${BASE}u=x&expires=1&sig=y`)).toBe(true);
  });
});

describe("the GIF switches", () => {
  it("useKlipyEnabled follows the key as it is set and cleared", () => {
    const { result } = renderHook(() => useKlipyEnabled());
    expect(result.current).toBe(false);

    act(() => setKlipyApiKey("klipy_abc"));
    expect(result.current).toBe(true);

    act(() => setKlipyApiKey("   "));
    expect(result.current).toBe(false);
  });

  it("useGifsEnabled turns on for a key, or for a server that proxies", async () => {
    const { result } = renderHook(() => useGifsEnabled());
    expect(result.current).toBe(false);

    serverSupports({ available: true, media_base: BASE });
    await act(() => askServerGifSupport());
    expect(result.current).toBe(true);

    act(() => forgetServerGifSupport());
    expect(result.current).toBe(false);

    act(() => setKlipyApiKey("klipy_abc"));
    expect(result.current).toBe(true);
  });
});
