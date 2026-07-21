import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NewUiApp from "./index";

const { setSelectedUiDesignMock } = vi.hoisted(() => ({
  setSelectedUiDesignMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@ui/selection", () => ({
  getUiDesignOverride: () => null,
  setSelectedUiDesign: setSelectedUiDesignMock,
}));

describe("NewUiApp", () => {
  beforeEach(() => setSelectedUiDesignMock.mockClear());

  const renderApp = () => render(<MemoryRouter><NewUiApp /></MemoryRouter>);

  it("renders the functional new client shell and opens its design system", () => {
    renderApp();
    expect(screen.getByTestId("new-client-root")).toBeTruthy();
    expect(screen.getByText("Join a conversation")).toBeTruthy();

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
