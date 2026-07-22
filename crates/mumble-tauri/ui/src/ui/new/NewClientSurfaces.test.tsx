import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@core/store";
import { ScreenSharePanel } from "./components";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

describe("ScreenSharePanel", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation((command: string) => command === "list_capture_sources" ? Promise.resolve([
      { id: 1, kind: "screen", title: "Main display", width: 2560, height: 1440 },
      { id: 2, kind: "window", title: "Project window", width: 1280, height: 900 },
    ]) : command === "capture_source_thumbnail" ? Promise.resolve("data:image/jpeg;base64,preview") : Promise.resolve(undefined));
    useAppStore.setState({ broadcastingSessions: new Set([7]), users: [], isSharingOwn: false });
  });

  it("subscribes to the broadcasting set without producing unstable snapshots", async () => {
    render(<ScreenSharePanel onClose={vi.fn()} />);
    expect(screen.getByText("Share your screen")).toBeTruthy();
    expect(screen.getByText("A member")).toBeTruthy();
    expect((await screen.findAllByText("Main display")).length).toBeGreaterThan(0);
    expect(screen.getByRole("tab", { name: /Screens/ }).getAttribute("aria-selected")).toBe("true");
    expect(invokeMock).toHaveBeenCalledWith("capture_source_thumbnail", expect.objectContaining({ kind: "screen", id: 1 }));
  });
});
