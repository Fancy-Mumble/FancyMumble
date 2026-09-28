import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PLUGIN_NAME_LIVE_DOC } from "@core/constants/pluginData";
import { useNebulaLiveDoc } from "./useNebulaLiveDoc";

const { state, saveDocLink, saveDocToDefault } = vi.hoisted(() => ({
  state: {
    activeServerId: "srv" as string | null,
    activeLiveDocs: new Map<string, { slug: string; title: string }>(),
    pendingLiveDocAnnounces: new Map<string, unknown>(),
    pluginInfos: new Map<string, unknown>(),
    requestOpenLiveDoc: vi.fn(),
    clearLiveDocAnnounce: vi.fn(),
    setPendingLiveDocSeed: vi.fn(),
  },
  saveDocLink: vi.fn(),
  saveDocToDefault: vi.fn(),
}));

vi.mock("@core/store", () => ({
  liveDocKey: (server: string | null, channel: number) => `${server ?? ""}/${channel}`,
  useAppStore: Object.assign((select: (s: typeof state) => unknown) => select(state), {
    getState: () => state,
  }),
}));

vi.mock("@core/features/chat/livedoc/sidebarStore", () => ({
  useLiveDocSidebarStore: { getState: () => ({ saveDocLink, saveDocToDefault }) },
}));

function mount(channelId: number | null = 7, isDm = false) {
  const onNotice = vi.fn();
  const view = renderHook(() => useNebulaLiveDoc({ channelId, isDm, onNotice }));
  return { ...view, onNotice };
}

/** Put a document on the channel the pane is showing. */
function openDoc(channelId = 7) {
  state.activeLiveDocs = new Map([[`srv/${channelId}`, { slug: "notes-abc123", title: "Notes" }]]);
}

describe("useNebulaLiveDoc", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.activeLiveDocs = new Map();
    state.pendingLiveDocAnnounces = new Map();
    state.pluginInfos = new Map([[PLUGIN_NAME_LIVE_DOC, {}]]);
    state.requestOpenLiveDoc.mockResolvedValue(undefined);
  });

  it("reports the feature as absent while the server has no live-doc plugin", () => {
    state.pluginInfos = new Map();
    expect(mount().result.current.available).toBe(false);
  });

  it("finds the document belonging to the channel on screen, not another one", () => {
    openDoc(7);
    expect(mount(7).result.current.session?.title).toBe("Notes");
    expect(mount(9).result.current.session).toBeUndefined();
  });

  it("gives a document the pane until the reader asks for the conversation back", async () => {
    openDoc();
    const { result, rerender } = mount();
    expect(result.current.hidesChat).toBe(true);

    act(() => result.current.toggleChatVisible());
    expect(result.current.hidesChat).toBe(false);
    expect(result.current.chatVisible).toBe(true);

    // Closing the document forgets that they asked, so the next one opens the
    // same way the first did rather than inheriting a split nobody set.
    state.activeLiveDocs = new Map();
    rerender();
    await waitFor(() => expect(result.current.chatVisible).toBe(false));
  });

  it("gives a new document a slug of its own and files it in the same section Standard uses", async () => {
    const { result } = mount();
    await act(async () => {
      await result.current.submitLaunch({ mode: "new", title: "Notes", visibility: "publish" });
    });

    const [channel, slug, title] = state.requestOpenLiveDoc.mock.calls[0];
    expect(channel).toBe(7);
    expect(title).toBe("Notes");
    // Seeded by the title, decided by the suffix: two "Notes" must not collide.
    expect(slug).toMatch(/^notes-[a-z0-9]{1,6}$/);
    expect(saveDocToDefault).toHaveBeenCalledWith(
      expect.objectContaining({ slug, title: "Notes", channel: 7, owned: true }),
      "Saved",
    );
  });

  it("keeps a private document channel-less so filing it does not publish it", async () => {
    const { result } = mount();
    await act(async () => {
      await result.current.submitLaunch({ mode: "new", title: "Draft", visibility: "private" });
    });
    expect(saveDocToDefault).toHaveBeenCalledWith(expect.objectContaining({ channel: null }), "Saved");
  });

  it("reopens an existing document under its own slug rather than a fresh one", async () => {
    const { result } = mount();
    await act(async () => {
      await result.current.submitLaunch({ mode: "existing", title: "notes-abc123", visibility: "publish" });
    });
    expect(state.requestOpenLiveDoc.mock.calls[0][1]).toBe("notes-abc123");
    // Only a new document earns a sidebar entry; reopening one already has it.
    expect(saveDocToDefault).not.toHaveBeenCalled();
  });

  it("files into the folder the sidebar asked for", async () => {
    const { result } = mount();
    act(() => result.current.openLaunchInFolder?.("folder-2"));
    await act(async () => {
      await result.current.submitLaunch({ mode: "new", title: "Spec", visibility: "publish" });
    });
    expect(saveDocLink).toHaveBeenCalledWith("folder-2", expect.objectContaining({ title: "Spec" }));
    expect(saveDocToDefault).not.toHaveBeenCalled();
  });

  it("reopens a channel-less library entry privately, not into the open channel", () => {
    const { result } = mount();
    act(() => result.current.openLibraryDoc({ slug: "diary", title: "Diary", channel: null, owned: true }));
    expect(state.requestOpenLiveDoc).toHaveBeenCalledWith(7, "diary", "Diary", {
      silent: true,
      mode: "private",
    });
  });

  it("says so rather than throwing when there is no channel to open a document in", async () => {
    const { result, onNotice } = mount(null);
    await act(async () => {
      await result.current.submitLaunch({ mode: "new", title: "Notes", visibility: "publish" });
    });
    expect(state.requestOpenLiveDoc).not.toHaveBeenCalled();
    expect(onNotice).toHaveBeenCalled();
  });

  it("reports a failed open on the snackbar", async () => {
    state.requestOpenLiveDoc.mockRejectedValue(new Error("server said no"));
    const { result, onNotice } = mount();
    await act(async () => {
      await result.current.submitLaunch({ mode: "new", title: "Notes", visibility: "publish" });
    });
    expect(onNotice).toHaveBeenCalledWith(expect.stringContaining("server said no"));
  });

  it("has no folder filing in a direct message, which has no document tree", () => {
    expect(mount(7, true).result.current.openLaunchInFolder).toBeUndefined();
  });

  it("joins an announced document and clears the banner that offered it", async () => {
    state.pendingLiveDocAnnounces = new Map([
      ["srv/7", { channelId: 7, slug: "standup", title: "Standup", appServerId: "srv" }],
    ]);
    const { result } = mount();
    await act(async () => {
      await result.current.joinAnnounced();
    });
    // Silent: the invite card that announced it is still valid, and a plain
    // open would post a second one to the channel.
    expect(state.requestOpenLiveDoc).toHaveBeenCalledWith(7, "standup", "Standup", { silent: true });
    expect(state.clearLiveDocAnnounce).toHaveBeenCalledWith(7, "srv");
  });

  it("drops the library once a document takes the dock", async () => {
    const { result, rerender } = mount();
    act(() => result.current.openLibrary());
    expect(result.current.docked).toBe(true);

    openDoc();
    rerender();
    await waitFor(() => expect(result.current.libraryOpen).toBe(false));
  });

  it("forgets a dragged split height once nothing is using it", async () => {
    const { result } = mount();
    act(() => result.current.openLibrary());
    act(() => result.current.setSplitPx(320));
    expect(result.current.splitPx).toBe(320);

    act(() => result.current.closeLibrary());
    await waitFor(() => expect(result.current.splitPx).toBeNull());
  });
});
