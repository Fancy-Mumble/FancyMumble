import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@core/store";
import { ScreenSharePanel } from "./NewClientSurfaces";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue([]) }));

describe("ScreenSharePanel", () => {
  beforeEach(() => {
    useAppStore.setState({ broadcastingSessions: new Set([7]), users: [], isSharingOwn: false });
  });

  it("subscribes to the broadcasting set without producing unstable snapshots", () => {
    render(<ScreenSharePanel onClose={vi.fn()} />);
    expect(screen.getByText("Share your screen")).toBeTruthy();
    expect(screen.getByText("A member")).toBeTruthy();
  });
});
