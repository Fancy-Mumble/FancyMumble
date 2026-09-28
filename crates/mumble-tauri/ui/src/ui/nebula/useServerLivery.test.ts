import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@core/store";
import type { SessionMeta } from "@core/types";
import type { ServerLivery } from "./livery";
import { useServerLiveries, useServerLivery } from "./useServerLivery";

const { invokeMock, listenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));

/** The hook only subscribes inside the webview, so tests have to look like one. */
function pretendTauri(present: boolean) {
  if (present) (globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  else delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__;
}

type Push = (event: { payload: { livery: ServerLivery | null; serverId?: string | null } }) => void;

/** The `server-livery` handler the hook registered. */
let push: Push;

function livery(tagline: string): ServerLivery {
  return { version: 1, tagline, tags: [], palette: {} };
}

function session(id: string, host: string): SessionMeta {
  return {
    id,
    label: host,
    host,
    port: 64738,
    username: "MumbleUser",
    certLabel: null,
    status: "connected",
  };
}

/** Two servers open, the first of them in front of the user. */
function openBoth() {
  useAppStore.setState({
    sessions: [session("srv-a", "a.example"), session("srv-b", "b.example")],
    activeServerId: "srv-a",
  });
}

describe("useServerLiveries", () => {
  beforeEach(async () => {
    pretendTauri(true);
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(null);
    listenMock.mockReset();
    listenMock.mockImplementation((_event: string, handler: Push) => {
      push = handler;
      return Promise.resolve(() => undefined);
    });
    openBoth();
  });

  afterEach(() => {
    pretendTauri(false);
    useAppStore.setState({ sessions: [], activeServerId: null });
  });

  it("files a push under the server that sent it, not the one in front of the user", async () => {
    const { result } = renderHook(() => useServerLiveries());
    await waitFor(() => expect(listenMock).toHaveBeenCalled());

    act(() => push({ payload: { livery: livery("b's motto"), serverId: "srv-b" } }));

    // The regression this file exists for: one server's document must never
    // stand in for another's. `srv-a` is active and has said nothing, so it
    // has nothing to draw - even though `srv-b` just spoke.
    expect(result.current["srv-b"]?.tagline).toBe("b's motto");
    expect(result.current["srv-a"] ?? null).toBeNull();
  });

  it("files the mount read under the active server, which is who answered it", async () => {
    invokeMock.mockResolvedValue(livery("a's motto"));
    const { result } = renderHook(() => useServerLiveries());

    // `get_livery` takes no address: it reads through the same handle every
    // command does, so its answer belongs to the active session and nowhere
    // else.
    await waitFor(() => expect(result.current["srv-a"]?.tagline).toBe("a's motto"));
    expect(result.current["srv-b"] ?? null).toBeNull();
  });

  it("keeps each open server's document apart", async () => {
    const { result } = renderHook(() => useServerLiveries());
    await waitFor(() => expect(listenMock).toHaveBeenCalled());

    act(() => push({ payload: { livery: livery("a's motto"), serverId: "srv-a" } }));
    act(() => push({ payload: { livery: livery("b's motto"), serverId: "srv-b" } }));

    expect(result.current["srv-a"]?.tagline).toBe("a's motto");
    expect(result.current["srv-b"]?.tagline).toBe("b's motto");
  });

  it("drops a document whose session has closed", async () => {
    const { result } = renderHook(() => useServerLiveries());
    await waitFor(() => expect(listenMock).toHaveBeenCalled());
    act(() => push({ payload: { livery: livery("b's motto"), serverId: "srv-b" } }));
    expect(result.current["srv-b"]).not.toBeUndefined();

    // Artwork rides along as `data:` URIs, so a document nothing can reach any
    // more must not sit in memory for the life of the window.
    act(() => {
      useAppStore.setState({ sessions: [session("srv-a", "a.example")], activeServerId: "srv-a" });
    });
    await waitFor(() => expect(result.current["srv-b"]).toBeUndefined());
  });

  it("ignores a push it cannot attribute to any server", async () => {
    useAppStore.setState({ sessions: [], activeServerId: null });
    const { result } = renderHook(() => useServerLiveries());
    await waitFor(() => expect(listenMock).toHaveBeenCalled());

    act(() => push({ payload: { livery: livery("from nowhere") } }));

    // Adopting an unroutable document is precisely how one server's branding
    // used to end up on every server's page.
    expect(Object.keys(result.current)).toHaveLength(0);
  });
});

describe("useServerLivery", () => {
  beforeEach(async () => {
    pretendTauri(true);
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(null);
    listenMock.mockReset();
    listenMock.mockImplementation((_event: string, handler: Push) => {
      push = handler;
      return Promise.resolve(() => undefined);
    });
    openBoth();
  });

  afterEach(() => {
    pretendTauri(false);
    useAppStore.setState({ sessions: [], activeServerId: null });
  });

  it("answers only for the server asked about", async () => {
    const { result: asked } = renderHook(() => useServerLivery("srv-b"));
    await waitFor(() => expect(listenMock).toHaveBeenCalled());
    act(() => push({ payload: { livery: livery("b's motto"), serverId: "srv-b" } }));
    await waitFor(() => expect(asked.current?.tagline).toBe("b's motto"));
  });

  it("is null for a server that is not open, which is what the connect screen asks", async () => {
    // A saved address the user is merely looking at has no session and so has
    // sent nothing. Null here is what makes its page draw unbranded instead of
    // wearing whichever server happens to be connected.
    const { result } = renderHook(() => useServerLivery(null));
    await waitFor(() => expect(listenMock).toHaveBeenCalled());
    act(() => push({ payload: { livery: livery("b's motto"), serverId: "srv-b" } }));
    expect(result.current).toBeNull();
  });
});
