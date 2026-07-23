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

describe("AuroraApp", () => {
  beforeEach(() => {
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => document.body });
    setSelectedUiDesignMock.mockClear();
    getSavedServersMock.mockReset();
    getSavedServersMock.mockResolvedValue([]);
    useAppStore.setState({ status: "disconnected", sessions: [], activeServerId: null });
  });

  const renderApp = () => render(<MemoryRouter><AuroraApp /></MemoryRouter>);

  it("renders first-run onboarding and opens its design system", async () => {
    renderApp();
    expect(screen.getByTestId("aurora-client-root")).toBeTruthy();
    expect(await screen.findByText("Let’s get you connected.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Design system/i }));
    expect(screen.getByTestId("aurora-ui-root")).toBeTruthy();
    expect(screen.getByText("One interface.")).toBeTruthy();
    expect(screen.getByText("Conversation, redesigned")).toBeTruthy();
  });

  it("can switch back to the Standard UI", async () => {
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: /Standard UI/i }));
    await waitFor(() => {
      expect(setSelectedUiDesignMock).toHaveBeenCalledWith("standard");
    });
  });

  it("shows saved servers in a collapsible detailed launcher", async () => {
    getSavedServersMock.mockResolvedValueOnce([{ id: "studio", label: "Fancy studio", host: "voice.example.com", port: 64738, username: "Morgan", cert_label: null, favorite: true }]);
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
      sessions: [{ id: "studio", label: "Fancy studio", host: "voice.example.com", port: 64738, username: "Morgan", certLabel: null, status: "connected" }],
    });
    renderApp();
    const expand = screen.getByRole("button", { name: "Expand server sidebar" });
    expect(expand.getAttribute("aria-expanded")).toBe("false");
  });

  it("previews native title bars for each platform", () => {
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: /Design system/i }));
    expect(screen.getByLabelText("Windows window controls")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "macOS" }));
    expect(screen.getByLabelText("macOS window controls")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Linux" }));
    expect(screen.getByLabelText("Linux window controls")).toBeTruthy();
  });
});
