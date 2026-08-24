import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@core/store";
import AuroraApp from "./index";

const { setSelectedUiDesignMock, getSavedServersMock } = vi.hoisted(() => ({
  setSelectedUiDesignMock: vi.fn().mockResolvedValue(undefined),
  getSavedServersMock: vi.fn().mockResolvedValue([]),
}));

vi.mock("@ui/selection", () => ({
  getUiDesignOverride: () => null,
  setSelectedUiDesign: setSelectedUiDesignMock,
}));

vi.mock("@core/serverStorage", () => ({
  getSavedServers: getSavedServersMock,
  addServer: vi.fn(),
  updateServer: vi.fn(),
  removeServer: vi.fn(),
}));

// The settings surface reads its preference stores through the Tauri store
// plugin, which has no backend in jsdom; stub just the loaders so the panel
// renders (everything else in these modules stays real).
vi.mock("@core/preferencesStorage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@core/preferencesStorage")>()),
  getPreferences: vi
    .fn()
    .mockResolvedValue({
      userMode: "normal",
      hasCompletedSetup: true,
      defaultUsername: "",
      timeFormat: "auto",
      convertToLocalTime: true,
    }),
  updatePreferences: vi.fn().mockImplementation((patch: unknown) => Promise.resolve(patch)),
}));

vi.mock("@ui/standard/personalizationStorage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ui/standard/personalizationStorage")>()),
  loadPersonalization: vi
    .fn()
    .mockResolvedValue({
      theme: "dark",
      fontFamily: "inter",
      fontSize: "medium",
      fontSizeCustomPx: 16,
      compactMode: false,
      alwaysShowMessageActions: false,
    }),
  savePersonalization: vi.fn().mockResolvedValue(undefined),
}));

describe("AuroraApp", () => {
  beforeEach(() => {
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => document.body });
    setSelectedUiDesignMock.mockClear();
    getSavedServersMock.mockReset();
    getSavedServersMock.mockResolvedValue([]);
    useAppStore.setState({ status: "disconnected", sessions: [], activeServerId: null });
  });

  const renderApp = () =>
    render(
      <MemoryRouter>
        <AuroraApp />
      </MemoryRouter>,
    );

  /** Render as if the app was launched with the `?design-sheet` flag, which is
   *  the only way into the design inventory now that the chrome has no button
   *  for it. Restores the URL afterwards so other tests render the client. */
  const renderDesignSheet = () => {
    globalThis.history.replaceState({}, "", "/?design-sheet");
    try {
      return renderApp();
    } finally {
      globalThis.history.replaceState({}, "", "/");
    }
  };

  it("renders first-run onboarding", async () => {
    renderApp();
    expect(screen.getByTestId("aurora-client-root")).toBeTruthy();
    expect(await screen.findByText("Let’s get you connected.")).toBeTruthy();
  });

  it("keeps the design sheet out of the client chrome", () => {
    renderApp();
    expect(screen.queryByRole("button", { name: /Design system/i })).toBeNull();
    expect(screen.queryByTestId("aurora-ui-root")).toBeNull();
  });

  it("opens the design sheet from its launch flag", () => {
    renderDesignSheet();
    expect(screen.getByTestId("aurora-ui-root")).toBeTruthy();
    expect(screen.getByText("One interface.")).toBeTruthy();
    expect(screen.getByText("Conversation, redesigned")).toBeTruthy();
  });

  it("switches back to the Standard UI from the appearance settings", async () => {
    renderApp();
    // No title-bar shortcut: the switch lives with the other appearance
    // choices, reachable through the settings gear in every app state.
    expect(screen.queryByRole("button", { name: /Standard UI/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Appearance" }));
    fireEvent.click(await screen.findByRole("button", { name: /Aurora design/i }));
    await waitFor(() => {
      expect(setSelectedUiDesignMock).toHaveBeenCalledWith("standard");
    });
  });

  it("shows saved servers in a collapsible detailed launcher", async () => {
    getSavedServersMock.mockResolvedValueOnce([
      {
        id: "studio",
        label: "Fancy studio",
        host: "voice.example.com",
        port: 64738,
        username: "Morgan",
        cert_label: null,
        favorite: true,
      },
    ]);
    renderApp();
    expect(await screen.findByText("Your conversations")).toBeTruthy();
    expect(screen.getByText("voice.example.com:64738")).toBeTruthy();
    expect(screen.getByText("Morgan")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Collapse server sidebar" }));
    expect(screen.getByRole("button", { name: "Expand server sidebar" })).toBeTruthy();
  });

  it("starts with the server rail collapsed while connected", () => {
    useAppStore.setState({
      status: "connected",
      activeServerId: "studio",
      sessions: [
        {
          id: "studio",
          label: "Fancy studio",
          host: "voice.example.com",
          port: 64738,
          username: "Morgan",
          certLabel: null,
          status: "connected",
        },
      ],
    });
    renderApp();
    const expand = screen.getByRole("button", { name: "Expand server sidebar" });
    expect(expand.getAttribute("aria-expanded")).toBe("false");
  });

  it("shows the rejection reason instead of the connected chrome after a failed authentication", () => {
    useAppStore.setState({
      status: "disconnected",
      activeServerId: "studio",
      sessions: [
        {
          id: "studio",
          label: "Fancy studio",
          host: "voice.example.com",
          port: 64738,
          username: "Morgan",
          certLabel: null,
          status: "disconnected",
        },
      ],
      sessionErrors: { studio: "Wrong server password" },
      error: "Wrong server password",
      passwordRequired: false,
      pendingConnect: null,
    });
    renderApp();
    expect(screen.getByRole("alert").textContent).toContain("Wrong server password");
    expect(screen.getByText("Connection failed")).toBeTruthy();
    expect(screen.getByText("Morgan · voice.example.com:64738")).toBeTruthy();
    // The connected chrome must not be rendered for a session that never authenticated.
    expect(screen.queryByLabelText("Search channels")).toBeNull();
    expect(screen.queryByText("CHANNELS")).toBeNull();
  });

  it("reports a dropped link without describing it as a refusal", () => {
    useAppStore.setState({
      status: "disconnected",
      activeServerId: "studio",
      sessions: [
        {
          id: "studio",
          label: "Zewi@magical.rocks:64738",
          host: "magical.rocks",
          port: 64738,
          username: "Zewi",
          certLabel: null,
          status: "disconnected",
        },
      ],
      sessionErrors: { studio: "Connection to server was lost." },
      error: "Connection to server was lost.",
      passwordRequired: false,
      pendingConnect: null,
    });
    renderApp();
    expect(screen.getByRole("alert").textContent).toContain("Connection to server was lost.");
    // The card must not invent a cause that contradicts the server's wording.
    expect(screen.queryByText(/refused this connection/i)).toBeNull();
    // The address is shown once, not duplicated out of the session label.
    expect(screen.getByText("Zewi · magical.rocks:64738")).toBeTruthy();
  });

  it("keeps the password challenge available over the failed session", () => {
    useAppStore.setState({
      status: "disconnected",
      activeServerId: "studio",
      sessions: [
        {
          id: "studio",
          label: "Fancy studio",
          host: "voice.example.com",
          port: 64738,
          username: "Morgan",
          certLabel: null,
          status: "disconnected",
        },
      ],
      sessionErrors: { studio: "Wrong server password" },
      error: "Wrong server password",
      passwordRequired: true,
      passwordAttempted: true,
      pendingConnect: { host: "voice.example.com", port: 64738, username: "Morgan", certLabel: null },
    });
    renderApp();
    expect(screen.getByRole("dialog", { name: "Server password required" })).toBeTruthy();
    expect(screen.queryByLabelText("Search channels")).toBeNull();
  });

  // The design sheet is one very large page, and each platform switch re-renders
  // all of it: ~2.4s of pure layout on an idle machine, which the default 5s
  // budget only just covers and misses once the rest of the suite is competing
  // for the CPU. The work is synchronous - there is nothing here to wait for -
  // so the timeout is raised for this test rather than globally, where it would
  // hide a genuine hang somewhere else.
  it("previews native title bars for each platform", () => {
    renderDesignSheet();
    expect(screen.getByLabelText("Windows window controls")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "macOS" }));
    expect(screen.getByLabelText("macOS window controls")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Linux" }));
    expect(screen.getByLabelText("Linux window controls")).toBeTruthy();
  }, 20_000);
});
