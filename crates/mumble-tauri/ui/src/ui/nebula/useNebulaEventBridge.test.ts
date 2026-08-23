import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNebulaEventBridge } from "./useNebulaEventBridge";

const { initEventListenersMock } = vi.hoisted(() => ({
  initEventListenersMock: vi.fn(),
}));

vi.mock("@core/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@core/store")>()),
  initEventListeners: initEventListenersMock,
}));

/** The hook only subscribes inside the webview, so tests have to look like one. */
function pretendTauri(present: boolean) {
  if (present) (globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  else delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__;
}

describe("useNebulaEventBridge", () => {
  beforeEach(() => {
    initEventListenersMock.mockReset();
    initEventListenersMock.mockResolvedValue([]);
    pretendTauri(true);
  });
  afterEach(() => pretendTauri(false));

  it("subscribes to the backend event stream once", async () => {
    const { rerender } = renderHook(({ open }) => useNebulaEventBridge(open), {
      initialProps: { open: vi.fn() },
    });
    await waitFor(() => expect(initEventListenersMock).toHaveBeenCalledTimes(1));

    // A fresh callback identity must not resubscribe: that would drop every
    // listener the connected session depends on.
    rerender({ open: vi.fn() });
    expect(initEventListenersMock).toHaveBeenCalledTimes(1);
  });

  it("translates the store's router paths onto Nebula's screens", async () => {
    const open = vi.fn();
    renderHook(() => useNebulaEventBridge(open));
    await waitFor(() => expect(initEventListenersMock).toHaveBeenCalledTimes(1));

    const navigate = initEventListenersMock.mock.calls[0][0] as (path: string) => void;
    navigate("/chat");
    navigate("/");
    expect(open.mock.calls.map(([screen]) => screen)).toEqual(["chat", "connect"]);
  });

  it("routes through the latest callback after a re-render", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ open }) => useNebulaEventBridge(open), {
      initialProps: { open: first },
    });
    await waitFor(() => expect(initEventListenersMock).toHaveBeenCalledTimes(1));
    rerender({ open: second });

    const navigate = initEventListenersMock.mock.calls[0][0] as (path: string) => void;
    navigate("/chat");
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("chat");
  });

  it("releases the listeners on unmount", async () => {
    const unlisten = vi.fn();
    initEventListenersMock.mockResolvedValue([unlisten]);
    const { unmount } = renderHook(() => useNebulaEventBridge(vi.fn()));
    await waitFor(() => expect(initEventListenersMock).toHaveBeenCalledTimes(1));

    unmount();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("stays inert outside the webview", () => {
    pretendTauri(false);
    renderHook(() => useNebulaEventBridge(vi.fn()));
    expect(initEventListenersMock).not.toHaveBeenCalled();
  });
});
