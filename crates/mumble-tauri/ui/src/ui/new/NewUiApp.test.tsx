import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NewUiApp from "./index";

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

describe("NewUiApp", () => {
  beforeEach(() => {
    setSelectedUiDesignMock.mockClear();
    getSavedServersMock.mockReset();
    getSavedServersMock.mockResolvedValue([]);
  });

  const renderApp = () => render(<MemoryRouter><NewUiApp /></MemoryRouter>);

  it("renders first-run onboarding and opens its design system", async () => {
    renderApp();
    expect(screen.getByTestId("new-client-root")).toBeTruthy();
    expect(await screen.findByText("Let’s get you connected.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Design system/i }));
    expect(screen.getByTestId("new-ui-root")).toBeTruthy();
    expect(screen.getByText("One interface.")).toBeTruthy();
    expect(screen.getByText("Conversation, redesigned")).toBeTruthy();
  });

  it("can switch back to the legacy UI", async () => {
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: /Old UI/i }));
    await waitFor(() => {
      expect(setSelectedUiDesignMock).toHaveBeenCalledWith("legacy");
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
