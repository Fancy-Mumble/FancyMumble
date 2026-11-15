import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const SERVER_INFO = {
  host: "magical.rocks",
  port: 64738,
  user_count: 2,
  max_users: 101,
  release: "Starling 0.2.13",
  os: "linux (aarch64)",
  protocol_version: "1.6.0",
  fancy_version: null,
  max_bandwidth: 172000,
  opus: true,
};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "get_server_info") return Promise.resolve(SERVER_INFO);
    return Promise.resolve(null);
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => undefined) }));
vi.mock("@core/preferencesStorage", () => ({
  getPreferences: () => Promise.resolve({ userMode: "developer" }),
  getSavedAudioSettings: () => Promise.resolve(null),
}));

const { useAppStore } = await import("@core/store");
const ServerInfoPanel = (await import("./ServerInfoPanel")).default;

describe("Standard ServerInfoPanel", () => {
  it("lists what the server can do, and how it knows", async () => {
    // Starling: an epoch instead of a version, and the file service that comes
    // with it rather than the plugin.
    useAppStore.setState({
      serverFancyVersion: null,
      serverFancyProtocol: 1,
      fileServerKind: "canon",
      fileServerCapabilities: null,
      liveDocPluginConfig: null,
      pluginRegistry: [],
      channelPersistence: {},
    });

    render(<ServerInfoPanel onClose={() => {}} />);

    // The fold is closed until asked, like every other developer fold.
    const fold = await screen.findByRole("button", { name: "Server Features" });
    expect(screen.queryByText("Fancy extensions")).toBeNull();

    fireEvent.click(fold);
    expect(screen.getByText("Fancy extensions")).toBeTruthy();
    expect(screen.getByText("Yes · epoch 1")).toBeTruthy();
    expect(screen.getByText("File sharing")).toBeTruthy();
    expect(screen.getByText("Yes · built-in service")).toBeTruthy();
  });
});
