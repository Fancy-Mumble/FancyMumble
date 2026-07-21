/**
 * Regression tests for `useLiveDocSidebarStore.load()`.
 *
 * Guards against the "my documents disappeared" bug class:
 *   1. A *failed* private-storage read must never mark the sidebar
 *      persistable (`available`), otherwise the next edit's debounced
 *      persist would overwrite the real stored index with an empty one.
 *   2. When no file-server credentials are available yet, the load must
 *      fall back to an empty, non-persistable index without throwing.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  appState: { fileServerConfig: null as unknown },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => h.invokeMock(...args),
}));

vi.mock("../../store", () => ({
  useAppStore: { getState: () => h.appState },
}));

import { useLiveDocSidebarStore } from "../chat/livedoc/sidebarStore";

const READY_CONFIG = {
  baseUrl: "https://files.example",
  sessionJwt: "jwt-token",
  registered: true,
};

function resetStore() {
  useLiveDocSidebarStore.setState({
    index: { v: 1, sections: [] },
    loaded: false,
    available: false,
  });
}

describe("useLiveDocSidebarStore.load", () => {
  beforeEach(() => {
    h.invokeMock.mockReset();
    h.appState.fileServerConfig = null;
    resetStore();
  });

  it("does not mark the sidebar persistable when the server read fails", async () => {
    h.appState.fileServerConfig = READY_CONFIG;
    h.invokeMock.mockRejectedValueOnce(new Error("network down"));

    await useLiveDocSidebarStore.getState().load();

    const state = useLiveDocSidebarStore.getState();
    expect(h.invokeMock).toHaveBeenCalledWith("fileserver_get_private", expect.anything());
    expect(state.loaded).toBe(true);
    // available MUST stay false so a later edit cannot persist an empty
    // index over the real server-stored document tree.
    expect(state.available).toBe(false);
  });

  it("loads the server-stored index when a session is ready", async () => {
    h.appState.fileServerConfig = READY_CONFIG;
    h.invokeMock.mockResolvedValueOnce(
      JSON.stringify({
        v: 1,
        sections: [{ id: "s1", name: "Work", folders: [], docs: [] }],
      }),
    );

    await useLiveDocSidebarStore.getState().load();

    const state = useLiveDocSidebarStore.getState();
    expect(state.available).toBe(true);
    expect(state.index.sections).toHaveLength(1);
    expect(state.index.sections[0]?.name).toBe("Work");
  });

  it("falls back to a non-persistable empty index when no session exists", async () => {
    h.appState.fileServerConfig = null;

    await useLiveDocSidebarStore.getState().load();

    const state = useLiveDocSidebarStore.getState();
    expect(state.loaded).toBe(true);
    expect(state.available).toBe(false);
    expect(state.index.sections).toHaveLength(0);
    expect(h.invokeMock).not.toHaveBeenCalled();
  });
});
