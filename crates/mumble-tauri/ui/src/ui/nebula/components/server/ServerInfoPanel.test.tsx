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

  it("is a fixed-width panel beside the conversation, not a block in the column", async () => {
    render(withNebulaTheme(<ServerInfoPanel onClose={() => {}} />));

    const panel = await screen.findByRole("complementary", { name: "Server info" });
    // The layout bug this replaced came from a panel that sized itself as a row
    // in Nebula's window column; the roster's own geometry is the correct one.
    expect(getComputedStyle(panel).width).toBe("320px");
    expect(getComputedStyle(panel).flex).toBe("0 0 auto");
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
