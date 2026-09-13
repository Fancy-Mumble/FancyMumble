import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAppStore } from "@core/store";
import { withNebulaTheme } from "../../testTheme";
import { ServerInfoPanel } from "./ServerInfoPanel";

const SERVER_INFO = {
  host: "magical.rocks",
  port: 64738,
  user_count: 1,
  max_users: 101,
  release: "Starling 0.2.5",
  os: "linux (aarch64)",
  protocol_version: "1.6.0",
  fancy_version: null,
  max_bandwidth: 172000,
  opus: true,
};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "get_server_info") return Promise.resolve(SERVER_INFO);
    if (cmd === "get_welcome_text") return Promise.resolve(null);
    return Promise.resolve(null);
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => undefined) }));
// The developer section is behind a preference, so the mode is a knob the
// tests turn rather than a constant.
const prefs = vi.hoisted(() => ({ userMode: "normal" }));
vi.mock("@core/preferencesStorage", () => ({
  getPreferences: () => Promise.resolve({ userMode: prefs.userMode }),
  getSavedAudioSettings: () => Promise.resolve(null),
}));

describe("Nebula ServerInfoPanel", () => {
  it("shows the server's facts", async () => {
    render(withNebulaTheme(<ServerInfoPanel onClose={() => {}} />));

    // Once in the header, once as the Connection fact.
    expect(await screen.findAllByText("magical.rocks")).toHaveLength(2);
    expect(screen.getByText("64738")).toBeTruthy();
    expect(screen.getByText("1 / 101")).toBeTruthy();
    expect(screen.getByText("Starling 0.2.5")).toBeTruthy();
    expect(screen.getByText("Opus")).toBeTruthy();
  });

  it("opens as a sheet over the shell, like the channel sheet", async () => {
    render(withNebulaTheme(<ServerInfoPanel onClose={() => {}} />));

    const sheet = await screen.findByRole("document", { name: "Server info" });
    expect(screen.getByRole("dialog").contains(sheet)).toBe(true);
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("wears the server's livery name, and keeps the host beneath it", async () => {
    render(
      withNebulaTheme(
        <ServerInfoPanel
          livery={{ version: 1, displayName: "Magical Rocks", tags: [], palette: {} }}
          onClose={() => {}}
        />,
      ),
    );

    expect(await screen.findByText("Magical Rocks")).toBeTruthy();
    // Beneath the name, and as the Connection fact.
    expect(screen.getAllByText("magical.rocks")).toHaveLength(2);
  });

  it("lists what the server can do, in developer mode", async () => {
    prefs.userMode = "developer";
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

    render(withNebulaTheme(<ServerInfoPanel onClose={() => {}} />));

    // Closed until asked, like every other developer fold.
    const fold = await screen.findByText("Server Features");
    expect(screen.queryByText("Fancy extensions")).toBeNull();

    fireEvent.click(fold);
    expect(screen.getByText("Fancy extensions")).toBeTruthy();
    expect(screen.getByText("Yes · epoch 1")).toBeTruthy();
    expect(screen.getByText("Yes · built-in service")).toBeTruthy();
    prefs.userMode = "normal";
  });
});
