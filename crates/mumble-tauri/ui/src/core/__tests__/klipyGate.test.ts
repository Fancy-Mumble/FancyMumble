import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));

const { KLIPY_DISABLED_MESSAGE, setKlipyApiKey, useKlipyEnabled } =
  await import("../features/chat/gif/klipyConfig");
const { searchServerGifs } = await import("../features/chat/gif/serverGifs");
const { findKlipyMedia } = await import("../features/chat/gif/klipyClient");

afterEach(() => {
  setKlipyApiKey(undefined);
  invokeMock.mockReset();
  vi.restoreAllMocks();
});

describe("GIFs without a Klipy key", () => {
  // The server's answers are thumbnail addresses on Klipy's CDN, so even a
  // server-side search ends with this machine asking Klipy for pictures.
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
});

describe("useKlipyEnabled", () => {
  it("follows the key as it is set and cleared", () => {
    const { result } = renderHook(() => useKlipyEnabled());
    expect(result.current).toBe(false);

    act(() => setKlipyApiKey("klipy_abc"));
    expect(result.current).toBe(true);

    act(() => setKlipyApiKey("   "));
    expect(result.current).toBe(false);
  });
});
