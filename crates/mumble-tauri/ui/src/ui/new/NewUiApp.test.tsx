import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("renders the independent new UI shell", () => {
    render(<NewUiApp />);
    expect(screen.getByTestId("new-ui-root")).toBeTruthy();
    expect(screen.getAllByText("Design sheet")).toHaveLength(2);
    expect(screen.getByText("One interface.")).toBeTruthy();
    expect(screen.getByText("Conversation, redesigned")).toBeTruthy();
  });

  it("can switch back to the legacy UI", async () => {
    render(<NewUiApp />);
    fireEvent.click(screen.getByRole("button", { name: "Back to old UI" }));
    await waitFor(() => {
      expect(setSelectedUiDesignMock).toHaveBeenCalledWith("legacy");
    });
  });

  it("previews native title bars for each platform", () => {
    render(<NewUiApp />);
    expect(screen.getByLabelText("Windows window controls")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "macOS" }));
    expect(screen.getByLabelText("macOS window controls")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Linux" }));
    expect(screen.getByLabelText("Linux window controls")).toBeTruthy();
  });
});
