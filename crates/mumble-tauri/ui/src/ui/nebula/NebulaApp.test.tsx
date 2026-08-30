import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@core/store";
import NebulaApp from "./index";

const { getSavedServersMock, getPreferencesMock, updatePreferencesMock, dragDrop } = vi.hoisted(() => ({
  getSavedServersMock: vi.fn().mockResolvedValue([]),
  getPreferencesMock: vi.fn(),
  updatePreferencesMock: vi.fn(),
  /** The shell's drag-drop subscriber, as the client last registered it. */
  dragDrop: { handler: null as null | ((event: { payload: unknown }) => void) },
}));

// Files are dropped through the shell's own event, which has no source in
// jsdom: hold the handler the client registers so a test can drop on it.
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    onDragDropEvent: async (handler: (event: { payload: unknown }) => void) => {
      dragDrop.handler = handler;
      return () => {
        if (dragDrop.handler === handler) dragDrop.handler = null;
      };
    },
  }),
}));

const DEFAULT_PREFERENCES = {
  userMode: "normal",
  hasCompletedSetup: true,
  defaultUsername: "",
  timeFormat: "auto",
  convertToLocalTime: true,
};

// The admin pages subscribe to backend events that have no source in jsdom.
// Routing is what these tests are about, so the pane is stubbed down to the
// page id the shell hands it.
vi.mock("./components/admin/AdminScreen", () => ({
  AdminScreen: ({ page }: { page: string }) => <div>admin pane: {page}</div>,
}));

vi.mock("@core/serverStorage", () => ({
  getSavedServers: getSavedServersMock,
  addServer: vi.fn(),
  updateServer: vi.fn(),
  removeServer: vi.fn(),
  setServerPassword: vi.fn(),
  getServerPassword: vi.fn().mockResolvedValue(null),
  markServerJoined: vi.fn().mockResolvedValue(undefined),
}));

// The pack's screens read preferences through the Tauri store plugin, which has
// no backend in jsdom; stub only the loaders so everything else stays real.
vi.mock("@core/preferencesStorage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@core/preferencesStorage")>()),
  getPreferences: getPreferencesMock,
  updatePreferences: updatePreferencesMock,
}));

/** The saved server's own identity, connected. */
const OPEN_SESSION = {
  id: "sess",
  host: "magical.rocks",
  port: 64738,
  username: "ZewiWin",
  label: "magical.rocks",
  status: "connected",
};

const SERVER = {
  id: "s1",
  label: "magical.rocks",
  host: "magical.rocks",
  port: 64738,
  username: "ZewiWin",
  cert_label: null,
};

/**
 * Leave the server the way the dock now offers it.
 *
 * The status card gives the voice controls a row of their own, and `Leave`
 * sits at its right end rather than inside the overflow - one click, on the
 * button that says the word.
 */
async function leaveFromDock() {
  fireEvent.click(await screen.findByRole("button", { name: "Disconnect from this server" }));
}

describe("NebulaApp", () => {
  beforeEach(() => {
    getSavedServersMock.mockReset();
    getSavedServersMock.mockResolvedValue([SERVER]);
    getPreferencesMock.mockReset();
    getPreferencesMock.mockResolvedValue(DEFAULT_PREFERENCES);
    updatePreferencesMock.mockReset();
    updatePreferencesMock.mockImplementation((patch: unknown) => Promise.resolve(patch));
    useAppStore.setState({
      status: "disconnected",
      sessions: [],
      activeServerId: null,
      channels: [],
      users: [],
      messages: [],
      pollMessages: [],
      dmMessages: [],
      selectedChannel: null,
      selectedDmUser: null,
      selectedUser: null,
      currentChannel: null,
      ownSession: null,
    });
  });

  it("opens on the connect screen when nothing is connected", async () => {
    render(<NebulaApp />);
    expect(screen.getByTestId("nebula-client-root")).toBeTruthy();
    // The name appears twice by design: once in the server list, once as the
    // landing page's heading.
    expect(await screen.findByRole("heading", { name: "magical.rocks" })).toBeTruthy();
    expect(await screen.findByRole("button", { name: /connect as zewiwin/i })).toBeTruthy();
  });

  it("lists the servers once on the connect screen, in the open rail", async () => {
    // The screen used to carry its own Servers column beside the rail, saying
    // the same things about the same servers.
    render(<NebulaApp />);
    await screen.findByRole("heading", { name: "magical.rocks" });
    expect(screen.getAllByTestId("nebula-server-rail-panel")).toHaveLength(1);
    expect(screen.queryByTestId("nebula-server-rail")).toBeNull();
    expect(screen.getByLabelText("Search servers")).toBeTruthy();
  });

  it("shows the channel tree and the composer once connected", async () => {
    render(<NebulaApp />);
    useAppStore.setState({
      status: "connected",
      sessions: [
        {
          id: "sess",
          host: "magical.rocks",
          port: 64738,
          username: "ZewiWin",
          label: "magical.rocks",
        } as never,
      ],
      activeServerId: "sess",
      channels: [
        { id: 0, parent_id: null, name: "Root", user_count: 0, position: 0 } as never,
        { id: 1, parent_id: 0, name: "Gaming", user_count: 2, position: 100 } as never,
      ],
      selectedChannel: 1,
      currentChannel: 1,
      ownSession: 7,
      users: [{ session: 7, name: "ZewiWin", channel_id: 1, texture_size: null } as never],
    });

    // Two places by design: the channel tree and the conversation header. The
    // voice dock reports the voice state, which is inactive here, rather than
    // the channel - being in a channel is not the same as being in a call.
    await waitFor(() => expect(screen.getAllByText("Gaming")).toHaveLength(2));
    expect(screen.getByLabelText("Message #Gaming")).toBeTruthy();
    expect(screen.getByText("Voice off")).toBeTruthy();
    // Leaving means leaving the server, so it is live whenever there is a
    // session to leave - being in voice has nothing to do with it.
    expect(screen.getByRole("button", { name: "Disconnect from this server" })).toBeTruthy();
  });

  describe("dropping files", () => {
    /**
     * Connected, in a direct message with someone who is not registered.
     *
     * The classic DM is the case worth pinning: selecting one clears the
     * selected channel, and the drop used to be turned away on that alone
     * while the overlay still said "Drop files to send".
     */
    function openDirectMessage() {
      useAppStore.setState({
        status: "connected",
        sessions: [OPEN_SESSION as never],
        activeServerId: "sess",
        channels: [{ id: 0, parent_id: null, name: "Root", user_count: 2, position: 0 } as never],
        selectedChannel: null,
        currentChannel: 0,
        selectedDmUser: 9,
        ownSession: 7,
        users: [
          { session: 7, name: "ZewiWin", channel_id: 0, texture_size: null } as never,
          { session: 9, name: "Lorelando", channel_id: 0, texture_size: null } as never,
        ],
        fileServerConfig: { canShareFiles: true, canShareFilesPublic: false } as never,
      });
    }

    function drop(paths: string[]) {
      act(() => dragDrop.handler?.({ payload: { type: "drop", paths, position: { x: 0, y: 0 } } }));
    }

    it("stages a file dropped into a direct message straight away, no question asked", async () => {
      render(<NebulaApp />);
      openDirectMessage();
      expect(await screen.findByLabelText("Message @Lorelando")).toBeTruthy();
      await waitFor(() => expect(dragDrop.handler).not.toBeNull());

      drop(["/home/zewi/notes.pdf"]);
      // It lands in the tray directly - no dialog, nothing pressed first.
      expect(await screen.findByText("notes.pdf")).toBeTruthy();
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("turns away a drop that holds no file on disk, and says so", async () => {
      render(<NebulaApp />);
      openDirectMessage();
      await waitFor(() => expect(dragDrop.handler).not.toBeNull());

      // An image dragged out of a browser, or out of this chat, arrives as a
      // URL - which the uploader cannot stream from. Silence would look like
      // the drop did nothing.
      drop(["http://magical.rocks/files/dusk.png"]);
      expect(await screen.findByText("Only files from this computer can be dropped here")).toBeTruthy();
      expect(screen.queryByRole("dialog", { name: "Share files" })).toBeNull();
    });
  });

  it("asks before leaving a server, then disconnects the session", async () => {
    const disconnectSession = vi.fn().mockResolvedValue(undefined);
    render(<NebulaApp />);
    useAppStore.setState({
      status: "connected",
      sessions: [OPEN_SESSION as never],
      activeServerId: "sess",
      channels: [{ id: 0, parent_id: null, name: "Root", user_count: 0, position: 0 } as never],
      disconnectSession,
    });

    await leaveFromDock();
    // Nothing has happened yet: the confirmation is the point.
    expect(disconnectSession).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Leave this server?");
    fireEvent.click(within(dialog).getByRole("button", { name: "Leave" }));
    await waitFor(() => expect(disconnectSession).toHaveBeenCalledWith("sess"));
  });

  it("writes the shared preference when told not to ask again", async () => {
    // The same flag Standard's Advanced settings owns, so silencing the prompt
    // in one design silences it in the other.
    const disconnectSession = vi.fn().mockResolvedValue(undefined);
    render(<NebulaApp />);
    useAppStore.setState({
      status: "connected",
      sessions: [OPEN_SESSION as never],
      activeServerId: "sess",
      channels: [{ id: 0, parent_id: null, name: "Root", user_count: 0, position: 0 } as never],
      disconnectSession,
    });

    await leaveFromDock();
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Leave" }));

    await waitFor(() => expect(updatePreferencesMock).toHaveBeenCalledWith({ showDisconnectWarning: false }));
  });

  it("stays connected when the confirmation is dismissed", async () => {
    const disconnectSession = vi.fn().mockResolvedValue(undefined);
    render(<NebulaApp />);
    useAppStore.setState({
      status: "connected",
      sessions: [OPEN_SESSION as never],
      activeServerId: "sess",
      channels: [{ id: 0, parent_id: null, name: "Root", user_count: 0, position: 0 } as never],
      disconnectSession,
    });

    await leaveFromDock();
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(disconnectSession).not.toHaveBeenCalled();
  });

  it("leaves without asking once the warning has been turned off", async () => {
    getPreferencesMock.mockResolvedValue({ ...DEFAULT_PREFERENCES, showDisconnectWarning: false });
    const disconnectSession = vi.fn().mockResolvedValue(undefined);
    render(<NebulaApp />);
    useAppStore.setState({
      status: "connected",
      sessions: [OPEN_SESSION as never],
      activeServerId: "sess",
      channels: [{ id: 0, parent_id: null, name: "Root", user_count: 0, position: 0 } as never],
      disconnectSession,
    });

    await leaveFromDock();
    await waitFor(() => expect(disconnectSession).toHaveBeenCalledWith("sess"));
    expect(screen.queryByText("Leave this server?")).toBeNull();
  });

  it("offers a saved server as a new tab from the title bar's +", async () => {
    render(<NebulaApp />);
    fireEvent.click(await screen.findByLabelText("Quick connect"));

    const menu = await screen.findByRole("menu", { name: "Quick connect" });
    expect(menu.textContent).toContain("magical.rocks");
    expect(menu.textContent).toContain("Add server by address…");
    expect(menu.textContent).toContain("Browse public servers");
  });

  it("leaves an already-open login out of quick connect", async () => {
    render(<NebulaApp />);
    useAppStore.setState({ sessions: [OPEN_SESSION as never], activeServerId: "sess" });
    fireEvent.click(await screen.findByLabelText("Quick connect"));

    const menu = await screen.findByRole("menu", { name: "Quick connect" });
    expect(menu.textContent).toContain("Every saved login is already open.");
  });

  it("still offers the second identity on a server it is already connected to", async () => {
    // Being in magical.rocks as ZewiWin says nothing about arriving as Sebi:
    // that is a separate tab, and quick connect is the way to open it.
    getSavedServersMock.mockResolvedValue([SERVER, { ...SERVER, id: "s2", username: "Sebi" }]);
    render(<NebulaApp />);
    useAppStore.setState({ sessions: [OPEN_SESSION as never], activeServerId: "sess" });
    fireEvent.click(await screen.findByLabelText("Quick connect"));

    const menu = await screen.findByRole("menu", { name: "Quick connect" });
    expect(menu.textContent).toContain("magical.rocks");
    expect(menu.textContent).toContain("as Sebi");
  });

  it("offers a server again after its session disconnects", async () => {
    // The title bar draws no tab for a disconnected session, so quick connect
    // is the only way back to it.
    render(<NebulaApp />);
    useAppStore.setState({
      sessions: [{ ...OPEN_SESSION, status: "disconnected" } as never],
      activeServerId: "sess",
    });
    fireEvent.click(await screen.findByLabelText("Quick connect"));

    const menu = await screen.findByRole("menu", { name: "Quick connect" });
    expect(menu.textContent).toContain("magical.rocks");
  });

  it("opens settings on the profile page, with the nav beside it", async () => {
    // The nav decides what to list from the session and the server, so it is
    // rendered with the whole client rather than on its own: a nav asking the
    // shell for something the shell does not pass takes the client down with it.
    render(<NebulaApp />);
    useAppStore.setState({
      status: "connected",
      sessions: [OPEN_SESSION as never],
      activeServerId: "sess",
      channels: [{ id: 0, parent_id: null, name: "Root", user_count: 0, position: 0 } as never],
      ownSession: 7,
      users: [{ session: 7, name: "ZewiWin", channel_id: 0, texture_size: null } as never],
    });

    fireEvent.click(await screen.findByRole("button", { name: "More" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Settings" }));

    expect(await screen.findByRole("button", { name: "Profile" })).toBeTruthy();
    for (const page of ["Voice", "Personalize", "Privacy", "Shortcuts", "Advanced"])
      expect(screen.getByRole("button", { name: page })).toBeTruthy();
    // Unregistered here, on a server announcing no Fancy version: neither page
    // would have anything to show.
    expect(screen.queryByRole("button", { name: "Account" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Plugins" })).toBeNull();
  });

  it("returns to settings after a visit to administration", async () => {
    // Administration is a section *of* settings rather than its own surface, so
    // the admin page outlives the screen it was opened on. The menu's Settings
    // has to clear it, or it reopens on the admin page every time after.
    render(<NebulaApp />);
    useAppStore.setState({
      status: "connected",
      sessions: [OPEN_SESSION as never],
      activeServerId: "sess",
      channels: [
        { id: 0, parent_id: null, name: "Root", user_count: 0, position: 0, permissions: 0x1 } as never,
      ],
      ownSession: 7,
      users: [{ session: 7, name: "ZewiWin", channel_id: 0, texture_size: null } as never],
    });

    fireEvent.click(await screen.findByRole("button", { name: "More" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Server admin" }));
    expect(await screen.findByText("admin pane: users")).toBeTruthy();

    fireEvent.click(await screen.findByRole("button", { name: /Back/ }));
    fireEvent.click(await screen.findByRole("button", { name: "More" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Settings" }));

    expect(await screen.findByRole("button", { name: "Profile" })).toBeTruthy();
    expect(screen.queryByText("admin pane: users")).toBeNull();
  });

  /** The client, connected, with a channel selected and two more to move to. */
  async function connectedClient(selectChannel = vi.fn().mockResolvedValue(undefined)) {
    render(<NebulaApp />);
    useAppStore.setState({
      status: "connected",
      sessions: [OPEN_SESSION as never],
      activeServerId: "sess",
      channels: [
        { id: 0, parent_id: null, name: "Root", user_count: 0, position: 0 } as never,
        { id: 1, parent_id: 0, name: "Gaming", user_count: 2, position: 100 } as never,
        { id: 2, parent_id: 0, name: "Lounge", user_count: 1, position: 200 } as never,
      ],
      selectedChannel: 1,
      currentChannel: 1,
      ownSession: 7,
      users: [
        { session: 7, name: "ZewiWin", channel_id: 1, texture_size: null } as never,
        { session: 8, name: "Ada", channel_id: 2, texture_size: null } as never,
      ],
      selectChannel,
    });
    await screen.findByLabelText("Search channels");
    return { selectChannel };
  }

  describe("keyboard shortcuts", () => {
    // The bindings cannot be read in jsdom - the store is a Tauri plugin - so
    // these are the defaults every design ships with.
    it("focuses the column's search field on the quick-search binding", async () => {
      await connectedClient();
      fireEvent.keyDown(document.body, { key: "f", ctrlKey: true });
      await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Search channels")));
    });

    it("advertises the binding it actually answers to", async () => {
      await connectedClient();
      expect(screen.getByText("Ctrl+F")).toBeTruthy();
    });

    it("hides and restores the channel column", async () => {
      await connectedClient();
      fireEvent.keyDown(document.body, { key: "b", ctrlKey: true });
      await waitFor(() => expect(screen.queryByLabelText("Search channels")).toBeNull());
      fireEvent.keyDown(document.body, { key: "b", ctrlKey: true });
      expect(await screen.findByLabelText("Search channels")).toBeTruthy();
    });

    it("steps through the channels in the order the sidebar draws them", async () => {
      const { selectChannel } = await connectedClient();
      fireEvent.keyDown(document.body, { key: "ArrowDown", altKey: true });
      await waitFor(() => expect(selectChannel).toHaveBeenCalledWith(2));
      fireEvent.keyDown(document.body, { key: "ArrowUp", altKey: true });
      await waitFor(() => expect(selectChannel).toHaveBeenCalledWith(0));
    });

    it("opens the global search, and lands on what is chosen in it", async () => {
      const { selectChannel } = await connectedClient();
      fireEvent.keyDown(document.body, { key: "F", ctrlKey: true, shiftKey: true });

      const search = await screen.findByLabelText("Search channels, people and messages");
      // Somewhere in another channel is reachable from here without first
      // opening the screen that lists it - and without waiting on the backend,
      // which the window has not asked yet this early in the keystroke.
      fireEvent.change(search, { target: { value: "Lounge" } });
      fireEvent.keyDown(search, { key: "Enter" });
      await waitFor(() => expect(selectChannel).toHaveBeenCalledWith(2));
    });

    it("toggles the member roster", async () => {
      await connectedClient();
      fireEvent.keyDown(document.body, { key: "u", ctrlKey: true });
      expect(await screen.findByLabelText("Members")).toBeTruthy();
      fireEvent.keyDown(document.body, { key: "u", ctrlKey: true });
      await waitFor(() => expect(screen.queryByLabelText("Members")).toBeNull());
    });
  });

  // Full-app coverage for the wiring `NebulaClientApp` does itself, on top of
  // what `Composer.test.tsx` already proves about the props once they arrive -
  // a store that says a channel can share files and be polled must actually
  // reach the composer saying so, not just the component in isolation.
  //
  // Every field the ternaries in `NebulaClientApp` actually branch on
  // (`fileServerConfig`, `selectedDmUser`) is set explicitly by each test
  // here rather than left to `connectedClient()`'s defaults: the store is a
  // module singleton that outlives any one `it()`, and an earlier test in
  // this file (`selectedDmUser: 9`, in "dropping files" above) leaking
  // forward silently switches these from channel to DM context otherwise.
  describe("attaching and polling once a channel can do both", () => {
    it("does not block the attach button once the store has a real file-server config", async () => {
      await connectedClient();
      useAppStore.setState({
        selectedDmUser: null,
        fileServerConfig: { canShareFiles: true, canShareFilesPublic: false } as never,
      });
      expect(await screen.findByLabelText("Attach files")).toBeTruthy();
      fireEvent.click(screen.getByLabelText("Attach files"));
      expect(screen.queryByRole("dialog", { name: "Files" })).toBeNull();
    });

    it("still says why when the server has no file sharing at all", async () => {
      await connectedClient();
      useAppStore.setState({ selectedDmUser: null, fileServerConfig: null });
      const button = await screen.findByLabelText("This server has no file sharing");
      fireEvent.click(button);
      expect(screen.getByText(/no file sharing/)).toBeTruthy();
    });

    it("offers Create a poll from the attach menu in a channel with a file server", async () => {
      await connectedClient();
      useAppStore.setState({
        selectedDmUser: null,
        fileServerConfig: { canShareFiles: true, canShareFilesPublic: false } as never,
      });
      const button = await screen.findByLabelText("Attach files");
      fireEvent.contextMenu(button);
      expect(screen.getByText("Create a poll")).toBeTruthy();
    });
  });

  it("routes an auxiliary window to its own page instead of the client", () => {
    globalThis.history.replaceState({}, "", "/?updater");
    try {
      render(<NebulaApp />);
      expect(screen.queryByTestId("nebula-client-root")).toBeNull();
    } finally {
      globalThis.history.replaceState({}, "", "/");
    }
  });
});
