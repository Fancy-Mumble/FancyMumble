/**
 * Regression tests for `useLiveDocSidebarStore.load()`.
 *
 * Guards against the "my documents disappeared" bug class:
 *   1. A *failed* private-storage read must never mark the sidebar
 *      persistable (`available`), otherwise the next edit's debounced
 *      persist would overwrite the real stored index with an empty one.
 *   2. When no file-server credentials are available yet, the load must
 *      fall back to an empty, non-persistable index without throwing.
 *   3. A registered user is never told they are not registered: the reason
 *      the sidebar is unavailable comes from their own session, not from a
 *      file-server config that reports `registered: false` for everyone when
 *      the server runs no file-server plugin.
 *   4. The server's own record store is preferred, and the file-server plugin
 *      is only reached for when the server has no record store at all. A
 *      server that has both must not be read from one and written to the
 *      other.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  /** What `account_record_get` does. Defaults to a server with no record
   *  store, which is what every file-server-plugin test below assumes. */
  recordGet: vi.fn(),
  recordPut: vi.fn(),
  appState: {
    fileServerConfig: null as unknown,
    ownSession: 7 as number | null,
    users: [] as { session: number; user_id?: number | null }[],
  },
}));

/** A server that has never heard of records, worded as the backend words it. */
const NO_RECORD_STORE = "this server does not keep per-account records";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, ...rest: unknown[]) => {
    // Dispatched by command so one test can have a record store answer and
    // the plugin refuse, which is the case that catches a load and a persist
    // disagreeing about where the sidebar lives.
    if (command === "account_record_get") return h.recordGet(...rest);
    if (command === "account_record_put") return h.recordPut(...rest);
    return h.invokeMock(command, ...rest);
  },
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

/** The session's own user entry, registered (with a `user_id`) or not. */
function iAm(registered: boolean) {
  h.appState.users = [{ session: 7, user_id: registered ? 42 : null }];
}

function resetStore() {
  useLiveDocSidebarStore.setState({
    index: { v: 1, sections: [] },
    loaded: false,
    available: false,
    reason: null,
  });
}

describe("useLiveDocSidebarStore.load", () => {
  beforeEach(() => {
    h.invokeMock.mockReset();
    h.recordGet.mockReset();
    h.recordPut.mockReset();
    // Unless a test says otherwise, the server has no record store and the
    // plugin is the only thing there - which is what these tests were
    // written against.
    h.recordGet.mockRejectedValue(new Error(NO_RECORD_STORE));
    h.recordPut.mockRejectedValue(new Error(NO_RECORD_STORE));
    h.appState.fileServerConfig = null;
    iAm(true);
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

  it("does not call a registered user a guest when the server keeps no library", async () => {
    // What a Starling without the file-server plugin looks like: the config
    // the client synthesises says `registered: false` about everybody.
    h.appState.fileServerConfig = { baseUrl: "", sessionJwt: "", registered: false };

    await useLiveDocSidebarStore.getState().load();

    expect(useLiveDocSidebarStore.getState().reason).toBe("unsupported");
  });

  it("calls an unregistered user a guest when there is nowhere to persist", async () => {
    iAm(false);
    h.appState.fileServerConfig = null;

    await useLiveDocSidebarStore.getState().load();

    expect(useLiveDocSidebarStore.getState().reason).toBe("guest");
  });

  it("reads a 403 to a registered user as an error, not as being a guest", async () => {
    // The file-server refuses a rejected session token - an expired one, say -
    // with the same "forbidden:" prefix it uses for guests.
    h.appState.fileServerConfig = READY_CONFIG;
    h.invokeMock.mockRejectedValueOnce("forbidden: invalid session token: expired");

    await useLiveDocSidebarStore.getState().load();

    expect(useLiveDocSidebarStore.getState().reason).toBe("error");
  });

  it("reads a 403 to an unregistered user as being a guest", async () => {
    iAm(false);
    h.appState.fileServerConfig = READY_CONFIG;
    h.invokeMock.mockRejectedValueOnce("forbidden: private storage is registered users only");

    await useLiveDocSidebarStore.getState().load();

    expect(useLiveDocSidebarStore.getState().reason).toBe("guest");
  });

  it("reads the sidebar out of the server's own record store", async () => {
    h.recordGet.mockResolvedValueOnce({
      value: JSON.stringify({ v: 1, sections: [{ id: "s1", name: "Work", folders: [], docs: [] }] }),
      found: true,
      updatedAtMs: 1,
    });

    await useLiveDocSidebarStore.getState().load();

    const state = useLiveDocSidebarStore.getState();
    expect(state.available).toBe(true);
    expect(state.reason).toBeNull();
    expect(state.index.sections[0]?.name).toBe("Work");
    expect(h.invokeMock).not.toHaveBeenCalled();
  });

  it("treats a record that is not there yet as an empty, persistable library", async () => {
    // The first run on a server that keeps records: nothing stored, and
    // everything about to be.
    h.recordGet.mockResolvedValueOnce({ value: null, found: false, updatedAtMs: 0 });

    await useLiveDocSidebarStore.getState().load();

    const state = useLiveDocSidebarStore.getState();
    expect(state.available).toBe(true);
    expect(state.reason).toBeNull();
    expect(state.index.sections).toHaveLength(0);
  });

  it("prefers the record store to the plugin when a server has both", async () => {
    // A server running the plugin *and* new enough to keep records. Reading
    // one and writing the other would lose edits with no error anywhere.
    h.appState.fileServerConfig = READY_CONFIG;
    h.recordGet.mockResolvedValueOnce({
      value: JSON.stringify({ v: 1, sections: [] }),
      found: true,
      updatedAtMs: 1,
    });

    await useLiveDocSidebarStore.getState().load();

    expect(h.invokeMock).not.toHaveBeenCalledWith("fileserver_get_private", expect.anything());
    expect(useLiveDocSidebarStore.getState().available).toBe(true);
  });

  it("calls a guest a guest when the record store refuses the account", async () => {
    h.recordGet.mockRejectedValueOnce(
      new Error("records are kept per account, and this connection is a guest"),
    );

    await useLiveDocSidebarStore.getState().load();

    const state = useLiveDocSidebarStore.getState();
    expect(state.reason).toBe("guest");
    expect(state.available).toBe(false);
  });

  it("does not mark the sidebar persistable when the record read fails", async () => {
    // Same rule as the plugin path, and the same reason: a read that failed
    // says nothing about what is stored, so a later edit must not be able to
    // write an empty tree over it.
    h.recordGet.mockRejectedValueOnce(new Error("connection reset"));

    await useLiveDocSidebarStore.getState().load();

    const state = useLiveDocSidebarStore.getState();
    expect(state.reason).toBe("error");
    expect(state.available).toBe(false);
  });

  it("shows a failed persist as an error instead of editing into the void", async () => {
    // The record ceiling, a dropped connection: a persist that fails used to
    // be a console line. The user kept editing a library that was no longer
    // being saved.
    vi.useFakeTimers();
    try {
      h.recordGet.mockResolvedValueOnce({ value: null, found: false, updatedAtMs: 0 });
      h.recordPut.mockRejectedValueOnce(new Error("a record may be at most 65536 bytes"));
      await useLiveDocSidebarStore.getState().load();
      expect(useLiveDocSidebarStore.getState().available).toBe(true);

      useLiveDocSidebarStore.getState().addSection("Work");
      await vi.runAllTimersAsync();

      const state = useLiveDocSidebarStore.getState();
      expect(state.reason).toBe("error");
      expect(state.available).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
