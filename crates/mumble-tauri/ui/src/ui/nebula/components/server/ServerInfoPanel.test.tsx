import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
vi.mock("@core/preferencesStorage", () => ({
  getPreferences: () => Promise.resolve({ userMode: "normal" }),
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
});
