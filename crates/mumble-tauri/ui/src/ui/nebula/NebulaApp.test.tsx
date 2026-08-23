import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@core/store";
import NebulaApp from "./index";

const { getSavedServersMock, getPreferencesMock, updatePreferencesMock } = vi.hoisted(() => ({
  getSavedServersMock: vi.fn().mockResolvedValue([]),
  getPreferencesMock: vi.fn(),
  updatePreferencesMock: vi.fn(),
}));

const DEFAULT_PREFERENCES = {
  userMode: "normal",
  hasCompletedSetup: true,
  defaultUsername: "",
  timeFormat: "auto",
  convertToLocalTime: true,
};

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
    expect(screen.getByRole("button", { name: "Leave" })).toHaveProperty("disabled", false);
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

    fireEvent.click(await screen.findByRole("button", { name: "Leave" }));
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

    fireEvent.click(await screen.findByRole("button", { name: "Leave" }));
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

    fireEvent.click(await screen.findByRole("button", { name: "Leave" }));
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

    fireEvent.click(await screen.findByRole("button", { name: "Leave" }));
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

    fireEvent.click(await screen.findByLabelText("Settings"));

    expect(await screen.findByRole("button", { name: "Profile" })).toBeTruthy();
    for (const page of ["Voice", "Personalize", "Privacy", "Shortcuts", "Advanced"])
      expect(screen.getByRole("button", { name: page })).toBeTruthy();
    // Unregistered here, on a server announcing no Fancy version: neither page
    // would have anything to show.
    expect(screen.queryByRole("button", { name: "Account" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Plugins" })).toBeNull();
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
