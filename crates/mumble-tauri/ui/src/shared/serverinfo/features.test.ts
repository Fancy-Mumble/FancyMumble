import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => undefined) }));

const { useAppStore } = await import("@core/store");
const { fancyVersionEncode } = await import("@core/utils/version");
const { useServerFeatures } = await import("./features");

/** The row for one feature, in the words the panel prints. */
function row(id: string): { label: string; value: string; support: string } {
  const { result } = renderHook(() => useServerFeatures());
  const found = result.current.find((feature) => feature.id === id);
  if (!found) throw new Error(`no row for ${id}`);
  return { label: found.label, value: found.value, support: found.support };
}

describe("useServerFeatures", () => {
  it("reads Starling out of the store: an epoch, and files without a plugin", () => {
    useAppStore.setState({
      serverFancyVersion: null,
      serverFancyProtocol: 1,
      fileServerKind: "canon",
      fileServerCapabilities: null,
      liveDocPluginConfig: null,
      pluginRegistry: [],
      channelPersistence: {},
    });

    expect(row("fancyExtensions")).toEqual({
      label: "Fancy extensions",
      support: "yes",
      value: "Yes · epoch 1",
    });
    expect(row("fileSharing").value).toBe("Yes · built-in service");
    // The canon service never answers `GET /capabilities`, so emotes stay open.
    expect(row("customEmotes").value).toBe("Unknown · no answer yet");
    expect(row("auditLog").value).toBe("Yes");
  });

  it("names the plugins a Fancy server has loaded", () => {
    useAppStore.setState({
      serverFancyVersion: fancyVersionEncode(0, 4, 2),
      serverFancyProtocol: null,
      serverConfig: { ...useAppStore.getState().serverConfig, webrtc_sfu_available: true },
      fileServerKind: "plugin",
      liveDocPluginConfig: { version: "0.3.0", wsBaseUrl: "wss://docs.example/ws" },
      pluginRegistry: [{ pluginName: "fancy-calendar", version: "0.1.4", pluginSlot: 1, infoJson: null }],
      channelPersistence: {},
    });

    expect(row("fancyExtensions").value).toBe("Yes · v0.4.2");
    expect(row("screenShare").value).toBe("Yes · WebRTC SFU");
    expect(row("liveDocs").value).toBe("Yes · v0.3.0");
    expect(row("calendar").value).toBe("Yes · v0.1.4");
  });

  it("counts the channels that keep their history", () => {
    useAppStore.setState({
      serverFancyProtocol: 1,
      channelPersistence: {
        1: {
          mode: "SIGNAL_V1",
          maxHistory: 0,
          retentionDays: 0,
          hasMore: false,
          isFetching: false,
          totalStored: 0,
        },
        2: {
          mode: "NONE",
          maxHistory: 0,
          retentionDays: 0,
          hasMore: false,
          isFetching: false,
          totalStored: 0,
        },
      },
    });

    expect(row("persistentChat").value).toBe("Yes · 1 channel(s)");
  });
});
